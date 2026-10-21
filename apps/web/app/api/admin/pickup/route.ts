import { NextResponse } from 'next/server';
import { isSameHostAdminJson } from '@/lib/auth/admin-json-request';
import { readCurrentAdminSession } from '@/lib/auth/session';
import { pickupConfigSchema } from '@/lib/commerce/offline-pickup';
import { getPickupConfig, savePickupConfig } from '@/lib/services/offline-pickup-service';
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return json({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401);
  return json({ ok: true, config: await getPickupConfig() });
}
export async function PUT(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return json({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401);
  if (session.role !== 'owner') return json({ ok: false, error: 'OWNER_REQUIRED' }, 403);
  if (!isSameHostAdminJson(request)) return json({ ok: false, error: 'INVALID_REQUEST_ORIGIN' }, 403);
  const parsed = pickupConfigSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: 'PICKUP_CONFIG_INCOMPLETE' }, 400);
  try { return json({ ok: true, config: await savePickupConfig(parsed.data, session.userId) }); }
  catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'PICKUP_SAVE_FAILED' }, 400); }
}
