import { NextResponse } from "next/server";
import { deleteSessionToken, readBearerToken } from "@/lib/auth/session";

export async function POST(request: Request) {
  const token = readBearerToken(request);
  if (token) await deleteSessionToken(token);
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
