import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { appConfig } from '@/lib/config';

const line = (max: number) => z.string().trim().max(max).refine(s => !/[\r\n\x00-\x1f]/.test(s));
export const PICKUP_DISTRICTS = ['市南区', '市北区', '李沧区', '崂山区', '黄岛区', '城阳区', '即墨区'] as const;
export const DEFAULT_PICKUP_DISTRICTS: Array<typeof PICKUP_DISTRICTS[number]> = ['市南区', '市北区', '李沧区', '崂山区'];
export const pickupConfigSchema = z.object({
  enabled: z.boolean(), name: line(60), address: line(240), hours: line(120), phone: line(40),
  districts: z.array(z.enum(PICKUP_DISTRICTS)).max(7).refine(v => new Set(v).size === v.length),
}).strict().refine(c => (!c.enabled || c.districts.length > 0) && (!c.phone || /^[+\d()\s-]{5,40}$/.test(c.phone)), 'PICKUP_CONFIG_INCOMPLETE');
export type PickupConfig = z.infer<typeof pickupConfigSchema>;
export const emptyPickupConfig: PickupConfig = { enabled: false, name: '', address: '', hours: '', phone: '', districts: DEFAULT_PICKUP_DISTRICTS };
export function normalizePickupConfig(value: unknown): PickupConfig {
  const parsed = pickupConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...emptyPickupConfig };
}
export function pickupPointVersion(config: PickupConfig) {
  return createHash('sha256').update(JSON.stringify([config.name, config.address, config.hours, config.phone, [...config.districts].sort()])).digest('hex');
}
export function addressSupportsPickup(config: PickupConfig, address: { province: string; city: string; district: string | null } | null) {
  if (!address || address.province.trim().replace(/省$/, '') !== '山东' || address.city.trim().replace(/市$/, '') !== '青岛') return false;
  return config.districts.some(d => d.replace(/区$/, '') === (address.district || '').trim().replace(/区$/, ''));
}
export type PickupChoice = { deliveryMethod?: 'DELIVERY' | 'PICKUP'; pickupPointVersion?: string; pickupContactName?: string; pickupContactPhone?: string };
export const pickupChoiceFields = {
  deliveryMethod: z.enum(['DELIVERY', 'PICKUP']).optional(),
  pickupPointVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  pickupContactName: line(40).min(1).optional(),
  pickupContactPhone: z.string().trim().regex(/^1[3-9]\d{9}$/).optional(),
};
export const pickupPublicSelect = 'order_id AS "orderId", status, point_name AS "name", point_address AS address, point_hours AS hours, point_phone AS phone, ready_at AS "readyAt", collected_at AS "collectedAt"';
export type PickupSummary = { orderId: string; status: string; name: string; address: string; hours: string; phone: string; readyAt: Date | null; collectedAt: Date | null; code?: string; blocked?: boolean; detailsPending?: boolean };
function key() { return createHash('sha256').update('merchantkit-pickup:' + appConfig.SESSION_SECRET).digest(); }
export function createPickupCode() {
  const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return { cipher: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url'), hash: hashPickupCode(code) };
}
export function revealPickupCode(encrypted: string) {
  const bytes = Buffer.from(encrypted, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const code = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  if (!/^\d{8}$/.test(code)) throw Error('PICKUP_CODE_INVALID');
  return code;
}
function hashPickupCode(code: string) { return createHmac('sha256', key()).update(code).digest('hex'); }
export function verifyPickupCode(hash: string, input: string) {
  return /^\d{8}$/.test(input) && /^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashPickupCode(input), 'hex'));
}
export function pickupHasHold(order: { status: string; paymentStatus: string; refunds?: Array<{ refundStatus: string; refundAmountCents: number }>; afterSalesRequests?: Array<{ status: string }> }) {
  return order.status !== 'CONFIRMED' || order.paymentStatus !== 'PAID'
    || !!order.refunds?.some(r => ['CREATED', 'MANUAL_MARKED', 'PROCESSING', 'SUCCEEDED'].includes(r.refundStatus))
    || !!order.afterSalesRequests?.some(r => !['CANCELLED', 'REJECTED', 'COMPLETED'].includes(r.status));
}
