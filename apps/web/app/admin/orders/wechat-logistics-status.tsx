"use client";

import { useCallback, useEffect, useState } from "react";

type Shipment = { shipmentId: string; trackingNo: string | null; state: string; reason?: string | null; errorCode?: string | null };
type Logistics = { enabled: boolean; activatedAt: string | null; shipments: Shipment[] };
const states: Record<string, string> = { DISABLED: "尚未启用", SCHEMA_REQUIRED: "物流服务尚未准备好", SENDING: "正在接入", BOUND: "已接入微信物流服务", FAILED: "接入未成功，需核对", UNKNOWN: "结果待核对，请勿重复提交", PENDING: "等待接入", NOT_REGISTERED: "尚未接入", INELIGIBLE: "不自动接入" };
const reasons: Record<string, string> = { BEFORE_ACTIVATION: "启用前已发出的运单，不自动补传", SHIPPING_UPLOAD_REQUIRED: "等待发货信息同步到微信", SHIPPING_SYNC_PENDING: "等待发货信息同步到微信" };

export function WeChatLogisticsStatus({ orderNo, updatedAt }: { orderNo: string; updatedAt: string }) {
  const [data, setData] = useState<Logistics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNo)}/logistics`, { signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok || !Array.isArray(result.logistics?.shipments)) throw Error("物流服务状态暂不可用，原有发货同步不受影响。");
      if (!signal?.aborted) setData(result.logistics);
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "状态读取失败。"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [orderNo]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh, updatedAt]);
  return <section className="mt-4 rounded-[8px] border border-[#d8dde5] bg-white p-4">
    <h3 className="text-sm font-black">微信物流查询与通知</h3>
    {data ? <><p className="mt-2 text-xs font-bold">{data.enabled ? "服务已启用，已有待发货订单在正常发货后也会自动接入。" : data.activatedAt ? "已暂停新运单接入，已接入运单仍可查询。" : "服务尚未启用；原有发货同步继续运行。"}</p>
      {data.shipments.map(item => <p className="mt-2 break-all text-xs leading-5" key={item.shipmentId}>{item.trackingNo || "运单号待补充"} · {states[item.state] || "尚未接入"}{item.reason && reasons[item.reason] ? `（${reasons[item.reason]}）` : ""}{item.state === "FAILED" ? "。请核对物流公司、单号及微信服务权限。" : ""}</p>)}
      {!data.shipments.length ? <p className="mt-2 text-xs text-[#697386]">暂无发货运单。</p> : null}</> : null}
    {error ? <p className="mt-2 text-xs text-red-700" role="alert">{error}</p> : null}
    <button className="vk-button vk-button-light mt-3 min-h-10 px-4 text-xs" disabled={loading} onClick={() => void refresh()} type="button">{loading ? "正在读取…" : "刷新接入状态"}</button>
  </section>;
}
