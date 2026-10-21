import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { addressSupportsPickup, createPickupCode, verifyPickupCode, revealPickupCode, pickupConfigSchema, pickupPointVersion, DEFAULT_PICKUP_DISTRICTS } from '@/lib/commerce/offline-pickup';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.pathname, '/vk_pickup_20261021');
  assert(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(process.env.WECHAT_API_BASE_URL, 'http://127.0.0.1:18997');
  const { prisma } = await import('@/lib/db/prisma');
  const service = await import('@/lib/services/offline-pickup-service');
  const orders = await import('@/lib/services/order-service');
  const { getDirectCheckoutForUser } = await import('@/lib/services/direct-checkout-service');
  const { syncPendingWeChatShipments: sync } = await import('@/lib/services/wechat-shipping-service');
  const suffix = randomUUID();
  const owner = await prisma.user.create({ data: { name: 'QA自提负责人', role: 'OWNER' } });
  const user = await prisma.user.create({ data: { name: 'QA自提会员', wechatIdentities: { create: { appId: process.env.WECHAT_MINIPROGRAM_APP_ID!, openId: 'qa-pickup-' + suffix } } } });
  const other = await prisma.user.create({ data: { name: 'QA其他会员' } });
  const config = { enabled: true, name: '隔离测试自提点', address: '青岛市市北区隔离测试地址', hours: '10:00–18:00', phone: '13900000006', districts: DEFAULT_PICKUP_DISTRICTS };
  for (const [key, value] of Object.entries({ commerceMode: 'OPEN', shippingFeeCents: 500, shippingRemoteFeeCents: 1000, shippingFarRemoteFeeCents: 2000 })) await prisma.siteSetting.create({ data: { key, value } });
  const product = await prisma.product.create({ data: { slug: 'x1-air-white', code: 'qa-pickup-sku', name: '隔离测试X1', category: 'TEST', summary: 'QA only', saleMode: 'IN_STOCK', skus: { create: { skuCode: 'qa-pickup-' + suffix, color: '白色', size: 'M', priceCents: 4900, stockQuantity: 100 } } }, include: { skus: true } });
  const sku = product.skus[0];
  const address = await prisma.address.create({ data: { userId: user.id, name: '测试取货人', phone: '13900000006', province: '山东省', city: '青岛市', district: '市北区', detail: '隔离测试收货地址' } });
  const outside = await prisma.address.create({ data: { userId: user.id, name: '测试取货人', phone: '13900000006', province: '山东省', city: '青岛市', district: '城阳区', detail: '区域之外' } });
  const selection = { productSlug: product.slug, color: '白色', size: 'M', quantity: 1 };
  const originalFetch = globalThis.fetch;
  type Remote = { trade: string; openid: string; uploaded: boolean; type: number; uploads: number; lose?: boolean };
  const remotes = new Map<string, Remote>();
  globalThis.fetch = async (input, init) => {
    const endpoint = new URL(String(input));
    assert.equal(endpoint.origin, 'http://127.0.0.1:18997', 'No real gateway traffic allowed');
    const body = JSON.parse(String(init?.body || '{}'));
    if (endpoint.pathname.endsWith('stable_token')) return Response.json({ access_token: 'qa-only', expires_in: 7200 });
    const txid = body.transaction_id || body.order_key?.transaction_id, remote = remotes.get(txid);
    assert(remote, 'Only synthetic payment transactions may be queried');
    if (endpoint.pathname.endsWith('get_order')) return Response.json({ errcode: 0, order: { transaction_id: txid, merchant_id: process.env.WECHAT_PAY_MCH_ID, merchant_trade_no: remote.trade, openid: remote.openid, order_state: remote.uploaded ? 2 : 1, shipping: { finish_shipping: remote.uploaded, logistics_type: remote.type, shipping_list: [] } } });
    assert(endpoint.pathname.endsWith('upload_shipping_info'));
    assert.equal(body.logistics_type, 4); assert.equal(body.delivery_mode, 1); assert.equal(body.payer.openid, remote.openid);
    assert.equal(body.shipping_list[0].tracking_no, undefined); assert.equal(body.shipping_list[0].express_company, undefined);
    assert(body.shipping_list[0].item_desc.includes('隔离测试'));
    remote.uploads++; remote.uploaded = true; remote.type = 4;
    if (remote.lose) { remote.lose = false; throw Error('Simulated lost HTTP reply'); }
    return Response.json({ errcode: 0 });
  };
  async function fixture(paid = true, point = config) {
    const orderNo = 'pickup-qa-' + randomUUID(), transaction = 'pickup-tx-' + randomUUID();
    const order = await prisma.order.create({ data: { orderNo, userId: user.id, status: paid ? 'CONFIRMED' : 'CREATED', paymentStatus: paid ? 'PAID' : 'NOT_STARTED', customerName: address.name, customerPhone: address.phone, addressSnapshot: address.detail, subtotalCents: 4900, payableAmountCents: 4900,
      items: { create: { productId: product.id, skuId: sku.id, productCode: product.code, productName: product.name, color: '白色', size: 'M', quantity: 1, unitPriceCents: 4900 } },
      ...(paid ? { paymentIntents: { create: { provider: 'WECHAT_PAY', method: 'wechat_jsapi', merchantOrderNo: orderNo, gatewayTradeNo: transaction, amountCents: 4900, status: 'PAID' } } } : {}),
    } });
    await prisma.$transaction(tx => service.createOrderPickup(tx, order.id, point));
    const remote: Remote = { trade: orderNo, openid: 'qa-pickup-' + suffix, uploaded: false, type: 0, uploads: 0 }; remotes.set(transaction, remote);
    return { order, remote };
  }
  async function read(orderNo: string) { const value = await orders.getOrderForUser(orderNo, user.id); assert(value && 'pickup' in value); return value; }
  async function ready(f: Awaited<ReturnType<typeof fixture>>) { await service.performPickupAction(f.order.orderNo, 'ready', owner.id); return (await read(f.order.orderNo)).pickup!.code!; }
  async function collect(f: Awaited<ReturnType<typeof fixture>>) { const code = await ready(f); await service.performPickupAction(f.order.orderNo, 'collect', owner.id, code); }
  try {
    await test('pickup settings are off by default and only the owner can enable the service', async () => {
      assert.equal((await service.getPickupConfig()).enabled, false);
      assert.equal(pickupConfigSchema.safeParse({ ...config, phone: 'invalid phone' }).success, false);
      await assert.rejects(service.savePickupConfig(config, user.id), /OWNER_REQUIRED/);
      await service.savePickupConfig(config, owner.id);
    });
    await test('only the four approved Qingdao districts qualify; missing or forged geography fails closed', async () => {
      for (const district of DEFAULT_PICKUP_DISTRICTS) assert(addressSupportsPickup(config, { ...address, district }));
      for (const patch of [{ district: '城阳区' }, { district: '黄岛区' }, { district: '即墨区' }, { district: '平度市' }, { city: '济南市' }, { province: '四川省' }, { district: null }]) assert.equal(addressSupportsPickup(config, { ...address, ...patch }), false);
      assert.equal((await service.getPickupAvailability(user.id, address.id)).eligible, true);
      assert.equal((await service.getPickupAvailability(user.id, outside.id)).reason, 'PICKUP_AREA_UNAVAILABLE');
      assert.equal((await service.getPickupAvailability(other.id, address.id)).eligible, false);
    });
    await test('pickup tokens are encrypted, preserve leading zeros and verify with bounded digits', () => {
      const encoded = createPickupCode(), code = revealPickupCode(encoded.cipher);
      assert.match(code, /^\d{8}$/); assert(verifyPickupCode(encoded.hash, code)); assert(!verifyPickupCode(encoded.hash, code.slice(1))); assert(!verifyPickupCode(encoded.hash, '000000000'));
      assert(!encoded.cipher.includes(code)); assert.notEqual(encoded.hash, code);
    });
    await test('direct checkout keeps goods and discounts; pickup has zero shipping fee and rejects outside addresses', async () => {
      const delivery = await getDirectCheckoutForUser(user.id, selection, address.id);
      const pickup = await getDirectCheckoutForUser(user.id, selection, address.id, { deliveryMethod: 'PICKUP', pickupPointVersion: pickupPointVersion(config) });
      assert.equal(delivery.quote!.shippingFeeCents, 500); assert.equal(pickup.quote!.shippingFeeCents, 0); assert.equal(delivery.quote!.subtotalCents, pickup.quote!.subtotalCents);
      await assert.rejects(getDirectCheckoutForUser(user.id, selection, outside.id, { deliveryMethod: 'PICKUP', pickupPointVersion: pickupPointVersion(config) }), /PICKUP_AREA_UNAVAILABLE/);
    });
    await test('pickup creation snapshots point, uses selected address contact and keeps existing direct-order idempotency', async () => {
      const delivery = { deliveryMethod: 'PICKUP' as const, pickupPointVersion: pickupPointVersion(config) }, quote = (await getDirectCheckoutForUser(user.id, selection, address.id, delivery)).quote!;
      const input = { userId: user.id, addressId: address.id, directSelection: selection, requestId: randomUUID(), useCoupons: true, expectedPayableCents: quote.payableAmountCents, ...delivery };
      const order = await orders.createOrderFromCart('direct-checkout', input), repeated = await orders.createOrderFromCart('direct-checkout', input);
      assert.equal(order.id, repeated.id); assert.equal(order.shippingFeeCents, 0); assert.equal(order.customerName, address.name);
      const created = await read(order.orderNo); assert.equal(created.pickup!.name, config.name); assert.equal(created.pickup!.code, undefined); assert.equal(created.shipments.length, 0);
      await assert.rejects(orders.createOrderFromCart('direct-checkout', { ...input, requestId: randomUUID(), addressId: outside.id }), /PICKUP_AREA_UNAVAILABLE/);
    });
    await test('unpaid pickup cannot be prepared and never exposes a token', async () => {
      const f = await fixture(false); await assert.rejects(service.performPickupAction(f.order.orderNo, 'ready', owner.id), /PICKUP_ORDER_BLOCKED/);
      assert.equal((await read(f.order.orderNo)).pickup!.code, undefined);
    });
    await test('ready pickup exposes token only to its buyer detail, never admin list, order list or another account', async () => {
      const f = await fixture(), code = await ready(f); assert.match(code, /^\d{8}$/);
      const readyAt = (await read(f.order.orderNo)).pickup!.readyAt!;
      assert(Math.abs(readyAt.getTime() - Date.now()) < 5000, 'Pickup timestamps use UTC independently of database timezone');
      const adminOrder = (await orders.listOrdersForAdmin()).find(o => o.id === f.order.id); assert(adminOrder && 'pickup' in adminOrder); assert.equal(adminOrder.pickup!.code, undefined);
      const listedOrder = (await orders.listOrdersByUser(user.id)).find(o => o.id === f.order.id); assert(listedOrder && 'pickup' in listedOrder); assert.equal(listedOrder.pickup!.code, undefined);
      assert.equal(await orders.getOrderForUser(f.order.orderNo, other.id), null);
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0); assert.equal(f.remote.uploads, 0);
      await assert.rejects(service.performPickupAction(f.order.orderNo, 'collect', user.id, code), /ADMIN_UNAUTHORIZED/);
    });
    await test('five invalid tokens persist an order-level lock without changing delivery or stock; expired lock can recover', async () => {
      const f = await fixture(), code = await ready(f), wrong = code === '00000000' ? '11111111' : '00000000';
      for (let n = 0; n < 5; n++) await assert.rejects(service.performPickupAction(f.order.orderNo, 'collect', owner.id, wrong), n === 4 ? /PICKUP_CODE_LOCKED/ : /PICKUP_CODE_MISMATCH/);
      await assert.rejects(service.performPickupAction(f.order.orderNo, 'collect', owner.id, code), /PICKUP_CODE_LOCKED/);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).fulfillmentStatus, 'PENDING');
      assert.equal(await prisma.shipment.count({ where: { orderId: f.order.id } }), 0);
      await prisma.$executeRaw`UPDATE order_pickups SET locked_until = ${new Date(Date.now() - 1000)} WHERE order_id = ${f.order.id}`;
      await service.performPickupAction(f.order.orderNo, 'collect', owner.id, code);
    });
    await test('simultaneous correct-token submissions create one fulfillment and one collection audit', async () => {
      const f = await fixture(), code = await ready(f), stock = await prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } });
      await Promise.all([service.performPickupAction(f.order.orderNo, 'collect', owner.id, code), service.performPickupAction(f.order.orderNo, 'collect', owner.id, code)]);
      assert.equal(await prisma.shipment.count({ where: { orderId: f.order.id } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { targetId: f.order.id, action: 'admin.pickup.collected' } }), 1);
      assert.equal((await prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } })).stockQuantity, stock.stockQuantity);
      assert.equal((await read(f.order.orderNo)).pickup!.code, undefined);
    });
    await test('courier ship/deliver and customer confirmation cannot bypass pickup verification', async () => {
      const f = await fixture(); await ready(f);
      for (const action of ['ship', 'deliver'] as const) await assert.rejects(orders.performAdminOrderAction(f.order.orderNo, { action, trackingCompany: '顺丰', trackingNo: 'QA' }, owner.id), /PICKUP_USE_COLLECTION_CODE/);
      await assert.rejects(orders.confirmOrderReceiptForUser(f.order.orderNo, user.id), /PICKUP_USE_COLLECTION_CODE/);
    });
    await test('refund and open after-sales states disable tokens and prevent collection', async () => {
      const f = await fixture(), code = await ready(f);
      await prisma.order.update({ where: { id: f.order.id }, data: { paymentStatus: 'REFUNDED', status: 'CLOSED' } });
      await assert.rejects(service.performPickupAction(f.order.orderNo, 'collect', owner.id, code), /PICKUP_ORDER_BLOCKED/);
      assert.equal((await read(f.order.orderNo)).pickup!.code, undefined);
      const g = await fixture(), code2 = await ready(g);
      await prisma.afterSalesRequest.create({ data: { afterSalesNo: 'pickup-as-' + randomUUID(), orderId: g.order.id, userId: user.id, type: 'REFUND_ONLY', reason: 'QA取消自提', description: '隔离测试', status: 'SUBMITTED' } });
      await assert.rejects(service.performPickupAction(g.order.orderNo, 'collect', owner.id, code2), /PICKUP_ORDER_BLOCKED/);
      assert.equal((await read(g.order.orderNo)).pickup!.code, undefined);
    });
    await test('collected pickup uploads type 4 without carrier or waybill and repeats do not upload twice', async () => {
      const f = await fixture(); await collect(f); assert.equal((await sync({ orderId: f.order.id })).synced, 1); assert.equal(f.remote.uploads, 1);
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0); assert.equal(f.remote.uploads, 1);
    });
    await test('lost WeChat reply retries by query and preserves original collection', async () => {
      const f = await fixture(); await collect(f); f.remote.lose = true;
      assert.equal((await sync({ orderId: f.order.id })).failed, 1); assert.equal(f.remote.uploads, 1);
      await prisma.shipment.updateMany({ where: { orderId: f.order.id }, data: { wechatRetryAt: null } });
      assert.equal((await sync({ orderId: f.order.id })).synced, 1); assert.equal(f.remote.uploads, 1);
    });
    await test('different existing WeChat delivery and transaction identity are never overwritten', async () => {
      const f = await fixture(); await collect(f); f.remote.uploaded = true; f.remote.type = 1;
      assert.equal((await sync({ orderId: f.order.id })).failed, 1); assert.equal(f.remote.uploads, 0);
      const g = await fixture(); await collect(g); g.remote.openid = 'wrong-openid';
      assert.equal((await sync({ orderId: g.order.id })).failed, 1); assert.equal(g.remote.uploads, 0);
    });
    await test('changed point invalidates new checkout but old pickup keeps its snapshot and can be collected after disabling', async () => {
      const f = await fixture(), code = await ready(f);
      await service.savePickupConfig({ ...config, enabled: false, address: '新的隔离地址' }, owner.id);
      await assert.rejects(getDirectCheckoutForUser(user.id, selection, address.id, { deliveryMethod: 'PICKUP', pickupPointVersion: pickupPointVersion(config) }), /PICKUP_UNAVAILABLE/);
      assert.equal((await read(f.order.orderNo)).pickup!.address, config.address);
      await service.performPickupAction(f.order.orderNo, 'collect', owner.id, code);
      await service.savePickupConfig({ ...config, address: '新的隔离地址' }, owner.id);
      await assert.rejects(getDirectCheckoutForUser(user.id, selection, address.id, { deliveryMethod: 'PICKUP', pickupPointVersion: pickupPointVersion(config) }), /PICKUP_POINT_CHANGED/);
    });
    await test('pickup is open to all customers without account or expiry limits while the address is pending', async () => {
      const pending = { ...config, enabled: true, name: '', address: '', hours: '', phone: '' };
      assert(pickupConfigSchema.safeParse(pending).success);
      assert.equal(pickupConfigSchema.safeParse({ ...pending, districts: [] }).success, false);
      await service.savePickupConfig(pending, owner.id);
      await prisma.siteSetting.create({ data: { key: 'offlinePickupTestAccess', value: { enabled: true, userIds: [user.id], expiresAt: new Date(0).toISOString() } } });
      const otherAddress = await prisma.address.create({ data: { userId: other.id, name: '其他会员', phone: '13900000021', province: '山东省', city: '青岛市', district: '市南区', detail: '隔离测试收货地址' } });
      for (const [customer, ownedAddress] of [[user, address], [other, otherAddress]] as const) {
        const availability = await service.getPickupAvailability(customer.id, ownedAddress.id);
        assert(availability.enabled && availability.eligible && availability.point);
        assert.equal(availability.point.address, '自提地点待公布');assert.equal(availability.point.detailsPending, true);assert.equal(availability.point.phone, '');
        const quote = await getDirectCheckoutForUser(customer.id, selection, ownedAddress.id, { deliveryMethod: 'PICKUP', pickupPointVersion: availability.point.version });
        assert.equal(quote.quote!.shippingFeeCents, 0);
      }
      assert.equal((await service.getPickupAvailability(user.id, otherAddress.id)).reason, 'ADDRESS_REQUIRED');
      assert.equal((await service.getPickupAvailability(user.id, outside.id)).reason, 'PICKUP_AREA_UNAVAILABLE');
      const version = pickupPointVersion(pending);
      const created = await orders.createOrderFromCart('global-pickup', { userId: user.id, addressId: address.id, directSelection: selection, requestId: randomUUID(), expectedPayableCents: 4900, deliveryMethod: 'PICKUP', pickupPointVersion: version });
      const readBack = await read(created.orderNo);assert.equal(readBack.pickup!.address, '自提地点待公布');assert.equal(readBack.pickup!.detailsPending, true);assert.equal(readBack.paymentStatus, 'NOT_STARTED');
      const saved = await service.getPickupConfig();assert.equal(saved.enabled, true);assert.equal(saved.address, '');assert(!('expiresAt' in saved));assert(!('userIds' in saved));
    });
    await test('publishing the later pickup details updates pending orders and preserves their pickup code', async () => {
      const pending = { ...config, enabled: true, name: '', address: '', hours: '', phone: '' };
      await service.savePickupConfig(pending, owner.id);const f = await fixture(true, pending);const code = await ready(f);
      assert.equal((await read(f.order.orderNo)).pickup!.detailsPending, true);
      await service.savePickupConfig(config, owner.id);
      const updated = (await read(f.order.orderNo)).pickup!;assert.equal(updated.address, config.address);assert.equal(updated.phone, config.phone);assert.equal(updated.detailsPending, false);assert.equal(updated.code, code);
      const raw = await prisma.$queryRaw<Array<{ address: string }>>`SELECT point_address AS address FROM order_pickups WHERE order_id = ${f.order.id}`;
      assert.equal(raw[0].address, '', 'Reading published details does not rewrite the order snapshot');
      await service.performPickupAction(f.order.orderNo, 'collect', owner.id, code);
      await service.savePickupConfig({ ...config, enabled: false }, owner.id);
      assert.equal((await service.getPickupAvailability(user.id, address.id)).enabled, false);assert.equal((await service.getPickupAvailability(other.id)).enabled, false);
    });
  } finally { globalThis.fetch = originalFetch; await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
