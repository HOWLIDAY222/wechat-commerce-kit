import { NextResponse } from "next/server";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { createAddress, listAddresses } from "@/lib/services/address-service";

const addressSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(6),
  province: z.string().min(1),
  city: z.string().min(1),
  district: z.string().optional(),
  detail: z.string().min(5),
  postalCode: z.string().optional(),
  isDefault: z.boolean().default(false),
});

export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    addresses: await listAddresses(session.userId),
  });
}

export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const parsed = addressSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_ADDRESS" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      ok: true,
      address: await createAddress(session.userId, parsed.data),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ADDRESS_CREATE_FAILED" },
      { status: 400 },
    );
  }
}
