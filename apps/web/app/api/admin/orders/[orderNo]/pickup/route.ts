import { after, NextResponse } from 'next/server';
import { isSameHostAdminJson } from '@/lib/auth/admin-json-request';
import { z } from 'zod';
import { readCurrentAdminSession } from '@/lib/auth/session';
import { performPickupAction } from '@/lib/services/offline-pickup-service';
import { syncPendingWeChatShipments } from '@/lib/services/wechat-shipping-service';
const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('ready') }).strict(), z.object({ action: z.literal('collect'), code: z.string().regex(/^\d{8}$/) }).strict()]);
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request, { params }: { params: Promise<{ orderNo: string }> }) {
  const session = await readCurrentAdminSession();
  if (!session) return json({ ok: false, error: 'ADMIN_UNAUTHORIZED' }, 401);
  if (!isSameHostAdminJson(request)) return json({ ok: false, error: 'INVALID_REQUEST_ORIGIN' }, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: 'PICKUP_CODE_INVALID' }, 400);
  try {
    const { orderNo } = await params;
    const result = await performPickupAction(orderNo, parsed.data.action, session.userId, 'code' in parsed.data ? parsed.data.code : '');
    if (result.status === 'COLLECTED') after(async () => {
      try { await syncPendingWeChatShipments({ orderId: result.orderId }); }
      catch { console.error('WECHAT_PICKUP_BACKGROUND_SYNC_FAILED'); }
    });
    return json({ ok: true, result });
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'PICKUP_ACTION_FAILED' }, 400); }
}
