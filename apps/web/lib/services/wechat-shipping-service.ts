import { orderUsesPickup } from '@/lib/services/offline-pickup-service';
import { Client } from "pg";
import { prisma } from "@/lib/db/prisma";
import { appConfig } from "@/lib/config";
import { getWeChatShippingOrder, resolveWeChatCarrier, weChatShippingRequest } from "@/lib/providers/wechat-shipping";

type SyncOptions = { orderId?: string };

// Serialize the web process and timer without holding order transactions during HTTP.
// PostgreSQL automatically releases this session lock when a process exits.
export async function syncPendingWeChatShipments(options: SyncOptions = {}) {
  if (!process.env.DATABASE_URL) throw new Error("WECHAT_SHIPPING_DATABASE_NOT_CONFIGURED");
  const lock = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await lock.connect();
  let acquired = false;
  try {
    acquired = (await lock.query("SELECT pg_try_advisory_lock(87432, 64015) AS acquired")).rows[0].acquired === true;
    if (!acquired) return { inspected: 0, synced: 0, failed: 0, skipped: 0, busy: true };
    return await syncShipments(options);
  } finally {
    if (acquired) await lock.query("SELECT pg_advisory_unlock(87432, 64015)").catch(() => undefined);
    await lock.end();
  }
}

async function syncShipments({ orderId }: SyncOptions) {
  const rows = await prisma.shipment.findMany({ where: {
    ...(orderId ? { orderId } : {}),
    wechatSyncedAt: null, status: { in: ["SHIPPED", "DELIVERED"] },
    OR: [{ wechatRetryAt: null }, { wechatRetryAt: { lte: new Date() } }],
    order: { status: "CONFIRMED", paymentStatus: "PAID", paymentIntents: { some: { provider: "WECHAT_PAY", status: "PAID" } } },
  }, include: { order: { include: { items: true, paymentIntents: { where: { provider: "WECHAT_PAY", status: "PAID" } }, user: { include: { wechatIdentities: true } } } } }, take: 50, orderBy: { createdAt: "asc" } });
  const report = { inspected: rows.length, synced: 0, failed: 0, skipped: 0, busy: false };
  for (const shipment of rows) {
    // Do not attach an old request's result to a concurrently corrected tracking number.
    const unchanged = { id: shipment.id, trackingNo: shipment.trackingNo, trackingCompany: shipment.trackingCompany, wechatSyncedAt: null };
    try {
      const payment = shipment.order.paymentIntents[0];
      const identity = shipment.order.user.wechatIdentities.find(item => item.appId === appConfig.WECHAT_MINIPROGRAM_APP_ID);
      if(shipment.order.kind==='GIFT_PURCHASE'){
        if(!identity||!payment.gatewayTradeNo)throw Error('WECHAT_SHIPPING_DATA_MISSING');
        const remote=await getWeChatShippingOrder(payment.gatewayTradeNo);
        if(remote.openid!==identity.openId||remote.merchant_trade_no!==payment.merchantOrderNo)throw Error('WECHAT_SHIPPING_ORDER_MISMATCH');
        if(remote.order_state===5)throw Error('WECHAT_SHIPPING_ORDER_REFUNDED');
        if(!remote.shipping?.finish_shipping)await weChatShippingRequest('/wxa/sec/order/upload_shipping_info',{
          order_key:{order_number_type:2,transaction_id:payment.gatewayTradeNo},logistics_type:3,delivery_mode:1,
          shipping_list:[{item_desc:'固定商品礼品卡已发放至购买人卡包，实体商品由收礼人兑换后配送。'}],
          upload_time:new Date().toISOString(),payer:{openid:identity.openId},
        });
        const updated=await prisma.shipment.updateMany({where:unchanged,data:{wechatSyncedAt:new Date(),wechatSyncError:null,wechatRetryAt:null,wechatSyncAttempts:{increment:1}}});
        if(updated.count)report.synced++;else report.skipped++;continue;
      }
      if (await orderUsesPickup(prisma, shipment.orderId)) {
        const picked = (await prisma.$queryRaw<Array<{status:string; collectedAt:Date|null}>>`SELECT status, collected_at AS "collectedAt" FROM order_pickups WHERE order_id = ${shipment.orderId}`)[0];
        const liveOrder = await prisma.order.findUnique({where:{id:shipment.orderId},include:{refunds:true,afterSalesRequests:true}});
        if (!picked || picked.status !== 'COLLECTED' || !picked.collectedAt || !liveOrder || liveOrder.paymentStatus !== 'PAID' || liveOrder.status !== 'CONFIRMED' || liveOrder.fulfillmentStatus !== 'DELIVERED') throw Error('WECHAT_PICKUP_NOT_COLLECTED');
        if (!identity || !payment.gatewayTradeNo) throw Error('WECHAT_SHIPPING_DATA_MISSING');
        const remote = await getWeChatShippingOrder(payment.gatewayTradeNo);
        if (remote.openid !== identity.openId || remote.merchant_trade_no !== payment.merchantOrderNo) throw Error('WECHAT_SHIPPING_ORDER_MISMATCH');
        if (remote.order_state === 5) throw Error('WECHAT_SHIPPING_ORDER_REFUNDED');
        if (remote.shipping?.finish_shipping) {
          if (remote.shipping.logistics_type !== 4 && remote.logistics_type !== 4) throw Error('WECHAT_SHIPPING_REMOTE_CONFLICT');
        } else {
          await weChatShippingRequest('/wxa/sec/order/upload_shipping_info', {
            order_key:{order_number_type:2,transaction_id:payment.gatewayTradeNo},logistics_type:4,delivery_mode:1,
            shipping_list:[{item_desc:Array.from(shipment.order.items.map(item=>`${item.productName} ${item.size} ×${item.quantity}`).join('；')).slice(0,120).join('')}],
            upload_time:new Date().toISOString(),payer:{openid:identity.openId},
          });
        }
        const updated = await prisma.shipment.updateMany({where:unchanged,data:{wechatSyncedAt:new Date(),wechatSyncError:null,wechatRetryAt:null,wechatSyncAttempts:{increment:1}}});
        if(updated.count)report.synced++;else report.skipped++;continue;
      }
      if (!identity || !payment.gatewayTradeNo || !shipment.trackingNo || !shipment.trackingCompany) throw new Error("WECHAT_SHIPPING_DATA_MISSING");
      const carrier = await resolveWeChatCarrier(shipment.trackingCompany);
      const remote = await getWeChatShippingOrder(payment.gatewayTradeNo);
      if (remote.openid !== identity.openId || remote.merchant_trade_no !== payment.merchantOrderNo) throw new Error("WECHAT_SHIPPING_ORDER_MISMATCH");
      if (remote.order_state === 5) throw new Error("WECHAT_SHIPPING_ORDER_REFUNDED");
      const alreadyUploaded = remote.shipping?.finish_shipping && remote.shipping.shipping_list?.some(item => item.tracking_no === shipment.trackingNo && item.express_company === carrier);
      // Query before retry: a lost HTTP response must not consume a second shipment opportunity.
      if (!alreadyUploaded) {
        if (remote.shipping?.finish_shipping) throw new Error("WECHAT_SHIPPING_REMOTE_CONFLICT");
        await weChatShippingRequest("/wxa/sec/order/upload_shipping_info", {
          order_key: { order_number_type: 2, transaction_id: payment.gatewayTradeNo }, logistics_type: 1, delivery_mode: 1,
          shipping_list: [{ tracking_no: shipment.trackingNo, express_company: carrier,
            item_desc: Array.from(shipment.order.items.map(item => `${item.productName} ${item.size} ×${item.quantity}`).join("；")).slice(0, 120).join(""),
            contact: { receiver_contact: `****${shipment.order.customerPhone.slice(-4)}` } }],
          upload_time: new Date().toISOString(), payer: { openid: identity.openId },
        });
      }
      const updated = await prisma.shipment.updateMany({ where: unchanged, data: { wechatSyncedAt: new Date(), wechatSyncError: null, wechatRetryAt: null, wechatSyncAttempts: { increment: 1 } } });
      if (updated.count) report.synced++; else report.skipped++;
    } catch (error) {
      const message = error instanceof Error && /^WECHAT_[A-Z0-9_-]+$/.test(error.message) ? error.message : "WECHAT_SHIPPING_SYNC_FAILED";
      const updated = await prisma.shipment.updateMany({ where: unchanged, data: { wechatSyncError: message, wechatSyncAttempts: { increment: 1 }, wechatRetryAt: new Date(Date.now() + Math.min(3600, 60 * 2 ** Math.min(shipment.wechatSyncAttempts, 6)) * 1000) } });
      if (updated.count) report.failed++; else report.skipped++;
    }
  }
  return report;
}
