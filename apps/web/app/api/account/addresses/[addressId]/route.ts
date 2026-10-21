import { NextResponse } from "next/server";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { deleteAddress, updateAddress } from "@/lib/services/address-service";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(6).optional(),
  province: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  district: z.string().optional(),
  detail: z.string().min(5).optional(),
  postalCode: z.string().optional(),
  isDefault: z.boolean().optional(),
});

type AddressRouteProps = {
  params: Promise<{ addressId: string }>;
};

export async function PATCH(request: Request, { params }: AddressRouteProps) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_ADDRESS_UPDATE" }, { status: 400 });
  }

  try {
    const { addressId } = await params;
    return NextResponse.json({
      ok: true,
      address: await updateAddress(session.userId, addressId, parsed.data),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ADDRESS_UPDATE_FAILED" },
      { status: 404 },
    );
  }
}

export async function DELETE(request: Request, { params }: AddressRouteProps) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  try {
    const { addressId } = await params;
    return NextResponse.json({
      ok: true,
      address: await deleteAddress(session.userId, addressId),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ADDRESS_DELETE_FAILED" },
      { status: 404 },
    );
  }
}
