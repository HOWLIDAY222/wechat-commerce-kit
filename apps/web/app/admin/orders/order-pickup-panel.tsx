'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
type Pickup = { status: string; name: string; address: string; hours: string; phone: string; collectedAt?: string | null; blocked?: boolean; detailsPending?: boolean };
const errors: Record<string, string> = { PICKUP_CODE_INVALID: '请输入8位取货码。', PICKUP_CODE_MISMATCH: '取货码不正确，请与顾客核对。', PICKUP_CODE_LOCKED: '取货码连续输错，请15分钟后重试。', PICKUP_NOT_READY: '请先完成备货。', PICKUP_ORDER_BLOCKED: '付款或售后状态已变化，当前不能核销。', PICKUP_STATE_CONFLICT: '订单交付状态已变化，请刷新核对。', ADMIN_UNAUTHORIZED: '登录已过期，请重新登录。' };
export function OrderPickupPanel({ orderNo, pickup }: { orderNo: string; pickup: Pickup }) {
  const router = useRouter(), lock = useRef(false);
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function act(action: 'ready' | 'collect') {
    if (lock.current || pickup.blocked || pickup.status === 'COLLECTED') return;
    if (action === 'collect' && !/^\d{8}$/.test(code)) { setMessage(errors.PICKUP_CODE_INVALID); return; }
    if (action === 'collect' && !window.confirm('确认已核对本订单商品并当面交付给取货人？')) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/orders/' + encodeURIComponent(orderNo) + '/pickup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'collect' ? { code } : {}) }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(errors[result.error] || '操作失败，请刷新后重试。');
      setCode(''); setMessage(result.result.status === 'COLLECTED' ? '取货已核销，微信订单同步处理中。' : '备货已完成，顾客可在订单里查看取货码。'); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : '连接中断，请刷新核对核销结果。'); router.refresh(); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section id="fulfillment-task" className="scroll-mt-24 rounded-lg border border-[#ddd] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">线下自提</h2><span className="rounded-full bg-[#f3f3f3] px-3 py-1">{pickup.status === 'COLLECTED' ? '已取货' : pickup.blocked ? '暂不可核销' : pickup.status === 'READY' ? '待自提' : '待备货'}</span></div>
    <div className="my-5 grid gap-2"><strong>{pickup.name}</strong><p>{pickup.address}</p>{pickup.hours || pickup.phone ? <p>{[pickup.hours, pickup.phone].filter(Boolean).join(' · ')}</p> : null}</div>
    {pickup.status === 'COLLECTED' ? <p>取货时间：{pickup.collectedAt ? new Date(pickup.collectedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '已记录'}</p> : pickup.blocked ? <p>请先处理付款或售后事项。</p> : pickup.status === 'WAITING' ? <button className="vk-button vk-button-dark min-h-11 px-8" disabled={busy} onClick={() => act('ready')}>{busy ? '正在保存…' : '完成备货'}</button> : <form className="grid max-w-sm gap-4" onSubmit={e => { e.preventDefault(); void act('collect'); }}><label className="vk-field">顾客取货码<input aria-label="顾客取货码" inputMode="numeric" autoComplete="off" maxLength={8} value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="输入顾客出示的8位数字" /></label><button className="vk-button vk-button-dark min-h-11" disabled={busy || code.length !== 8}>{busy ? '正在核销…' : '核销并交付'}</button></form>}
    {message ? <p className="mt-4" role="status">{message}</p> : null}
  </section>;
}
