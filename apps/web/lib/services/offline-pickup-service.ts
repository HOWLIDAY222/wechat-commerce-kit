import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { appConfig } from '@/lib/config';
import { completeMemberOrder } from '@/lib/services/membership-service';
import { addressSupportsPickup, createPickupCode, normalizePickupConfig, pickupConfigSchema, pickupHasHold, pickupPointVersion, revealPickupCode, verifyPickupCode, type PickupConfig, type PickupSummary } from '@/lib/commerce/offline-pickup';
import { presentPickupPoint } from '@/lib/commerce/pickup-test-access';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw' | 'siteSetting'>;
const KEY = 'offlinePickup';
export async function getPickupConfig(db: Pick<Db, 'siteSetting'> = prisma) {
  if (appConfig.COMMERCE_STORAGE !== 'prisma') return normalizePickupConfig(null);
  return normalizePickupConfig((await db.siteSetting.findUnique({ where: { key: KEY } }))?.value);
}
export async function getPickupAvailability(userId: string, addressId?: string) {
  const config = await getPickupConfig();
  const address = addressId ? await prisma.address.findFirst({ where: { id: addressId, userId } }) : null;
  const eligible = config.enabled && addressSupportsPickup(config, address);
  return { enabled: config.enabled, eligible, reason: !config.enabled ? 'PICKUP_UNAVAILABLE' : !address ? 'ADDRESS_REQUIRED' : !eligible ? 'PICKUP_AREA_UNAVAILABLE' : '', point: eligible ? { ...presentPickupPoint(config), version: pickupPointVersion(config) } : null };
}
export async function savePickupConfig(input: PickupConfig, actorId: string) {
  const config = pickupConfigSchema.parse(input);
  return prisma.$transaction(async tx => {
    const actor = await tx.user.findFirst({ where: { id: actorId, role: 'OWNER', status: 'ACTIVE' } });
    if (!actor) throw Error('OWNER_REQUIRED');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(87432, 64021)`;
    const before = await getPickupConfig(tx);
    await tx.siteSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: config }, update: { value: config } });
    await tx.auditLog.create({ data: { actorId, actorType: 'admin', action: 'admin.pickup.config.updated', targetType: 'setting', targetId: KEY, detail: { before, after: config } } });
    return config;
  });
}
export async function requirePickupPoint(db: Db, version: string | undefined, address: { province: string; city: string; district: string | null } | null) {
  const config = await getPickupConfig(db);
  if (!config.enabled) throw Error('PICKUP_UNAVAILABLE');
  if (!addressSupportsPickup(config, address)) throw Error('PICKUP_AREA_UNAVAILABLE');
  if (!version || version !== pickupPointVersion(config)) throw Error('PICKUP_POINT_CHANGED');
  return config;
}
export async function createOrderPickup(tx: Prisma.TransactionClient, orderId: string, config: PickupConfig) {
  const code = createPickupCode();
  await tx.$executeRaw`INSERT INTO order_pickups (id, order_id, status, point_name, point_address, point_hours, point_phone, code_cipher, code_hash, created_at, updated_at)
    VALUES (${randomUUID()}, ${orderId}, 'WAITING', ${config.name}, ${config.address}, ${config.hours}, ${config.phone}, ${code.cipher}, ${code.hash}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
}
export async function attachOrderPickups<T extends { id: string; status: string; paymentStatus: string; refunds?: Array<{ refundStatus: string; refundAmountCents: number }>; afterSalesRequests?: Array<{ status: string }> }>(orders: T[], includeUserCode = false): Promise<Array<T & { pickup: PickupSummary | null }>> {
  if (!orders.length) return [];
  const ids = orders.map(o => o.id);
  const rows = await prisma.$queryRaw<Array<PickupSummary & { codeCipher: string }>>`SELECT order_id AS "orderId", status, point_name AS name, point_address AS address, point_hours AS hours, point_phone AS phone, ready_at AS "readyAt", collected_at AS "collectedAt", code_cipher AS "codeCipher" FROM order_pickups WHERE order_id = ANY(${ids}::text[])`;
  const map = new Map(rows.map(r => [r.orderId, r]));
  const published = rows.some(row => !row.address.trim()) ? await getPickupConfig() : null;
  return orders.map(order => {
    const row = map.get(order.id);
    if (!row) return { ...order, pickup: null };
    const { codeCipher, ...pickup } = row;
    const blocked = pickupHasHold(order);
    const point = !pickup.address.trim() && published ? { ...pickup, name: pickup.name || published.name, address: published.address, hours: pickup.hours || published.hours, phone: pickup.phone || published.phone } : pickup;
    return { ...order, pickup: { ...presentPickupPoint(point), blocked, ...(includeUserCode && !blocked && row.status === 'READY' ? { code: revealPickupCode(codeCipher) } : {}) } };
  });
}
export async function orderUsesPickup(db: Pick<Db, '$queryRaw'>, orderId: string) {
  return !!(await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM order_pickups WHERE order_id = ${orderId}`)[0];
}
export async function performPickupAction(orderNo: string, action: 'ready' | 'collect', actorId: string, code = '') {
  const result = await prisma.$transaction(async tx => {
    const actor = await tx.user.findFirst({ where: { id: actorId, role: { in: ['ADMIN', 'OWNER'] }, status: 'ACTIVE' }, select: { id: true } });
    if (!actor) throw Error('ADMIN_UNAUTHORIZED');
    await tx.$queryRaw`SELECT id FROM orders WHERE order_no = ${orderNo} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { orderNo }, include: { shipments: true, afterSalesRequests: true, refunds: true } });
    if (!order) throw Error('ORDER_NOT_FOUND');
    const pickup = (await tx.$queryRaw<Array<{ id: string; status: string; codeHash: string; failedAttempts: number; lockedUntil: Date | null }>>`SELECT id, status, code_hash AS "codeHash", failed_attempts AS "failedAttempts", locked_until AS "lockedUntil" FROM order_pickups WHERE order_id = ${order.id} FOR UPDATE`)[0];
    if (!pickup) throw Error('ORDER_NOT_PICKUP');
    if (pickupHasHold(order)) throw Error('PICKUP_ORDER_BLOCKED');
    if (pickup.status === 'COLLECTED') return { orderId: order.id, status: 'COLLECTED', alreadyCollected: true };
    if (!['PENDING', 'PROCESSING'].includes(order.fulfillmentStatus) || order.shipments.length) throw Error('PICKUP_STATE_CONFLICT');
    if (action === 'ready') {
      if (pickup.status === 'READY') return { orderId: order.id, status: 'READY' };
      await tx.$executeRaw`UPDATE order_pickups SET status = 'READY', ready_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC', updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE id = ${pickup.id}`;
    } else {
      if (pickup.status !== 'READY') throw Error('PICKUP_NOT_READY');
      if (pickup.lockedUntil && pickup.lockedUntil.getTime() > Date.now()) throw Error('PICKUP_CODE_LOCKED');
      if (!verifyPickupCode(pickup.codeHash, code)) {
        const attempts = pickup.lockedUntil ? 1 : pickup.failedAttempts + 1;
        const until = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await tx.$executeRaw`UPDATE order_pickups SET failed_attempts = ${attempts}, locked_until = ${until}, updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE id = ${pickup.id}`;
        await tx.auditLog.create({ data: { actorId, actorType: 'admin', action: 'admin.pickup.code.rejected', targetType: 'order', targetId: order.id, detail: { orderNo, attempts } } });
        return { error: until ? 'PICKUP_CODE_LOCKED' : 'PICKUP_CODE_MISMATCH' };
      }
      const now = new Date();
      await tx.$executeRaw`UPDATE order_pickups SET status = 'COLLECTED', collected_at = ${now}, collected_by = ${actorId}, failed_attempts = 0, locked_until = NULL, updated_at = ${now} WHERE id = ${pickup.id}`;
      await tx.shipment.create({ data: { orderId: order.id, status: 'DELIVERED', shippedAt: now, deliveredAt: now } });
      await tx.order.update({ where: { id: order.id }, data: { fulfillmentStatus: 'DELIVERED' } });
      await completeMemberOrder(tx, order.id);
    }
    await tx.auditLog.create({ data: { actorId, actorType: 'admin', action: action === 'ready' ? 'admin.pickup.ready' : 'admin.pickup.collected', targetType: 'order', targetId: order.id, detail: { orderNo } } });
    return { orderId: order.id, status: action === 'ready' ? 'READY' : 'COLLECTED' };
  }, { maxWait: 5000, timeout: 15000 });
  if ('error' in result) throw Error(result.error);
  return result;
}
