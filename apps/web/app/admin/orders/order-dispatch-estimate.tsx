"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { isDispatchDate } from "@/lib/commerce/order-dispatch-estimate";

type Estimate = { status: string; startDate: string | null; endDate: string | null; timeZone: string; label: string; updatedAt: string | null; revision: number };
type EstimateState = { dispatchEstimate: Estimate; editable: boolean; reason: string | null };
const errors: Record<string, string> = {
  ADMIN_UNAUTHORIZED: "登录已过期，请重新登录。",
  ADMIN_REQUIRED: "当前账号无权调整预计发货日期。",
  ORDER_NOT_FOUND: "订单不存在，请刷新订单列表。",
  INVALID_DISPATCH_ESTIMATE: "请选择完整、有效的发货日期区间，并重新读取后核对。",
  DISPATCH_ESTIMATE_DATE_IN_PAST: "新的预计发货结束日期不能早于北京时间今天。",
  DISPATCH_ESTIMATE_UNAVAILABLE: "预计发货日期暂时无法读取，订单其他功能仍可使用。",
  DISPATCH_ESTIMATE_SCHEMA_REQUIRED: "预计发货日期服务暂不可用，订单其他功能仍可使用。",
};
const reasons: Record<string, string> = {
  DISPATCH_ESTIMATE_ORDER_NOT_PAID: "确认付款后可安排预计发货日期。",
  DISPATCH_ESTIMATE_ORDER_ALREADY_DISPATCHED: "订单已有履约记录，原预计日期保留为只读记录。",
  DISPATCH_ESTIMATE_SHIPMENT_EXISTS: "订单已有物流记录，原预计日期保留为只读记录。",
  DISPATCH_ESTIMATE_DIGITAL_GIFT_UNSUPPORTED: "此订单为礼品卡购买，无需安排实物发货。",
  DISPATCH_ESTIMATE_ORDER_NOT_CONFIRMED: "订单确认后可安排预计发货日期。",
  DISPATCH_ESTIMATE_ORDER_REFUNDED: "订单已退款，预计日期保留为只读记录。",
};

function parseState(value: unknown): EstimateState {
  const data = value as Partial<EstimateState> | null;
  const estimate = data?.dispatchEstimate;
  if (!estimate || typeof data?.editable !== "boolean" || !Number.isSafeInteger(estimate.revision) || estimate.revision < 0 ||
    !(estimate.startDate === null && estimate.endDate === null || isDispatchDate(estimate.startDate) && isDispatchDate(estimate.endDate) && estimate.startDate <= estimate.endDate) || estimate.timeZone !== "Asia/Shanghai" || typeof estimate.label !== "string") {
    throw new Error("预计发货信息格式异常，请重新读取。");
  }
  return { dispatchEstimate: estimate, editable: data.editable, reason: typeof data.reason === "string" ? data.reason : null };
}

function chinaToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function rangeLabel(estimate: Estimate) {
  if (!estimate.startDate || !estimate.endDate) return "未设置预计发货日期";
  const format = (date: string) => { const [year, month, day] = date.split("-").map(Number); return `${year}年${month}月${day}日`; };
  return `${format(estimate.startDate)}-${format(estimate.endDate)}`;
}

export function OrderDispatchEstimate({ orderNo, updatedAt }: { orderNo: string; updatedAt: string }) {
  const [state, setState] = useState<EstimateState | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saveLock = useRef(false);
  const saveSequence = useRef(0);
  const readSequence = useRef(0);
  const activeOrder = useRef(orderNo);
  activeOrder.current = orderNo;
  const endpoint = `/api/admin/orders/${encodeURIComponent(orderNo)}/dispatch-estimate`;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++readSequence.current;
    setLoading(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(errors[result.error] || "预计发货日期读取失败，请稍后重试。");
      const next = parseState(result);
      if (!signal?.aborted && sequence === readSequence.current && activeOrder.current === orderNo) {
        setState(next); setStartDate(next.dispatchEstimate.startDate || ""); setEndDate(next.dispatchEstimate.endDate || "");
      }
    } catch (cause) {
      if (!signal?.aborted && sequence === readSequence.current && activeOrder.current === orderNo) setError(cause instanceof Error ? cause.message : "预计发货日期读取失败。");
    } finally {
      if (!signal?.aborted && sequence === readSequence.current && activeOrder.current === orderNo) setLoading(false);
    }
  }, [endpoint, orderNo]);

  useEffect(() => {
    saveSequence.current++; saveLock.current = false; setSaving(false);
  }, [orderNo]);

  useEffect(() => {
    setState(null); setStartDate(""); setEndDate("");
    const controller = new AbortController(); void refresh(controller.signal);
    return () => { controller.abort(); readSequence.current++; };
  }, [refresh, updatedAt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state?.editable || saveLock.current || loading) return;
    if (Boolean(startDate) !== Boolean(endDate) || startDate && (!isDispatchDate(startDate) || !isDispatchDate(endDate) || startDate > endDate)) { setError("请填写完整日期区间，开始日期不能晚于结束日期。"); return; }
    if (endDate && endDate < chinaToday()) { setError("新的预计发货结束日期不能早于北京时间今天。"); return; }
    saveLock.current = true;
    const sequence = ++readSequence.current, saveId = ++saveSequence.current;
    const requestedOrder = orderNo;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: startDate || null, endDate: endDate || null, expectedRevision: state.dispatchEstimate.revision }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(response.status === 409 ? "订单状态或预计日期已变化。请重新读取，核对后再保存。" : errors[result.error] || "保存失败。请重新读取，核对结果后再操作。");
      const next = parseState(result);
      if (activeOrder.current === requestedOrder && sequence === readSequence.current) {
        setState(next); setStartDate(next.dispatchEstimate.startDate || ""); setEndDate(next.dispatchEstimate.endDate || "");
        setNotice(next.dispatchEstimate.startDate ? "已保存。顾客刷新小程序订单详情后可看到新日期区间。" : "已清空。顾客刷新订单后会看到预计发货时间待安排。");
      }
    } catch (cause) {
      if (activeOrder.current === requestedOrder && sequence === readSequence.current) setError(cause instanceof Error ? cause.message : "保存失败，请重新读取后核对。");
    } finally {
      if (saveSequence.current === saveId) saveLock.current = false;
      if (activeOrder.current === requestedOrder && saveSequence.current === saveId) setSaving(false);
    }
  }

  return <section className="mt-4 rounded-[8px] border border-[#d8dde5] bg-white p-4" id="dispatch-estimate">
    <h2 className="text-base font-black">预计发货日期</h2>
    <p className="mt-2 text-xs leading-5 text-[#697386]">按北京时间填写开始和结束日期。顾客将看到“2026年X月X日-2026年X月X日”。每笔订单独立保存，商品日期调整不会覆盖此处记录。</p>
    {state ? <>
      <p className="mt-3 text-sm font-bold" data-dispatch-start={state.dispatchEstimate.startDate || ""} data-dispatch-end={state.dispatchEstimate.endDate || ""}>{state.dispatchEstimate.startDate ? `${state.editable ? "预计发货日期：" : "原预计发货日期："}${rangeLabel(state.dispatchEstimate)}${state.editable ? "" : "（历史记录）"}` : state.dispatchEstimate.label}</p>
      {state.editable && state.dispatchEstimate.status === "OVERDUE" ? <p className="mt-2 text-xs text-red-700">原预计发货区间已结束，请核对实际安排后更新日期。</p> : null}
      {!state.editable ? <p className="mt-2 text-xs text-[#697386]">{reasons[state.reason || ""] || "当前订单状态不允许调整预计日期，已有记录仍保留。"}</p> : <form className="mt-3 grid gap-3" onSubmit={save}>
        <label className="vk-field">预计开始发货日期<input type="date" name="dispatchStartDate" aria-label="预计开始发货日期" value={startDate} disabled={saving || loading} onChange={event => setStartDate(event.currentTarget.value)} /></label>
        <label className="vk-field">预计结束发货日期<input type="date" name="dispatchEndDate" aria-label="预计结束发货日期" min={startDate > chinaToday() ? startDate : chinaToday()} value={endDate} disabled={saving || loading} onChange={event => setEndDate(event.currentTarget.value)} /></label>
        <p className="text-xs text-[#697386]">两个日期同时留空并保存后，顾客会看到“预计发货时间待安排”。</p>
        <button className="vk-button vk-button-light min-h-10" type="button" disabled={saving || loading || !startDate && !endDate} onClick={() => { setStartDate(""); setEndDate(""); }}>清空日期区间</button>
        <button className="vk-button vk-button-dark min-h-11" disabled={saving || loading || startDate === (state.dispatchEstimate.startDate || "") && endDate === (state.dispatchEstimate.endDate || "")} type="submit">{saving ? "正在保存…" : "保存预计发货日期"}</button>
      </form>}
    </> : null}
    <button className="vk-button vk-button-light mt-3 min-h-10 px-4 text-xs" disabled={loading || saving} type="button" onClick={() => void refresh()}>{loading ? "正在读取…" : "重新读取预计日期"}</button>
    {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
    {notice ? <p className="mt-3 text-sm" role="status">{notice}</p> : null}
  </section>;
}
