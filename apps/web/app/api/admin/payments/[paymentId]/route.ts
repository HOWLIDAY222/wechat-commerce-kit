import { NextResponse } from "next/server";

export async function PATCH() {
  return NextResponse.json({
    ok: false,
    error: "PAYMENT_STATUS_DIRECT_EDIT_FORBIDDEN_USE_PROVIDER_SYNC",
  }, { status: 405 });
}
