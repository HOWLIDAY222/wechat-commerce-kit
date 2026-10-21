import { NextResponse } from 'next/server';
import { readBearerUserSession } from '@/lib/auth/session';
import { getPickupAvailability } from '@/lib/services/offline-pickup-service';
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  const session = await readBearerUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: 'AUTH_REQUIRED' }, { status: 401, headers });
  const addressId = new URL(request.url).searchParams.get('addressId') || undefined;
  return NextResponse.json({ ok: true, pickup: await getPickupAvailability(session.userId, addressId) }, { headers });
}
