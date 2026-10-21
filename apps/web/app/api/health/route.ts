import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "merchantkit-next",
    time: new Date().toISOString(),
  });
}
