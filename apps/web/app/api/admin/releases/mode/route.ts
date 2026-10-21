import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminCapability } from "@/lib/admin/permission-policy";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { assertProductReadyForSale, listAdminProducts } from "@/lib/services/admin-catalog-service";
import { listAdminSettings, upsertAdminSetting } from "@/lib/services/admin-ops-service";
import { revalidateStorefront } from "@/lib/storefront-revalidation";

const schema = z.object({
  mode: z.enum(["SHOWCASE", "OPEN", "PAUSED"]),
  confirmation: z.string(),
});

export async function PUT(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  if (!hasAdminCapability(session.role, "manage_commerce_mode")) {
    return NextResponse.json({ ok: false, error: "ADMIN_OWNER_REQUIRED_FOR_COMMERCE_MODE" }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_COMMERCE_MODE_REQUEST" }, { status: 400 });
  const requiredConfirmation = parsed.data.mode === "OPEN" ? "OPEN_VALSENN_KROVEN_COMMERCE" : "CLOSE_VALSENN_KROVEN_COMMERCE";
  if (parsed.data.confirmation !== requiredConfirmation) {
    return NextResponse.json({ ok: false, error: "COMMERCE_MODE_CONFIRMATION_REQUIRED" }, { status: 400 });
  }

  if (parsed.data.mode === "OPEN") {
    const [products, settings] = await Promise.all([listAdminProducts(), listAdminSettings()]);
    const shippingKeys = ["shippingFeeCents", "shippingRemoteFeeCents", "shippingFarRemoteFeeCents"];
    const shippingReady = shippingKeys.every((key) => {
      const value = settings.find((item) => item.key === key)?.value;
      return typeof value === "number" && Number.isInteger(value) && value >= 0;
    });
    if (!shippingReady) {
      return NextResponse.json({ ok: false, error: "SHIPPING_FEE_CONFIGURATION_REQUIRED" }, { status: 409 });
    }
    const sellable = products.filter((product) => product.status === "ACTIVE" && (product.saleMode === "PREORDER" || product.saleMode === "IN_STOCK"));
    if (!sellable.length) return NextResponse.json({ ok: false, error: "SELLABLE_PRODUCT_REQUIRED_BEFORE_OPEN" }, { status: 409 });
    try {
      sellable.forEach(assertProductReadyForSale);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "SELLABLE_PRODUCT_NOT_READY" }, { status: 409 });
    }
  }

  const setting = await upsertAdminSetting({ key: "commerceMode", value: parsed.data.mode }, session.userId);
  revalidateStorefront();
  return NextResponse.json({ ok: true, setting });
}
