import Link from "next/link";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { getAnalyticsDashboard } from "@/lib/services/analytics-service";

type AnalyticsAdminPageProps = { searchParams: Promise<{ days?: string }> };

export const dynamic = "force-dynamic";
export const metadata = { title: "数据分析 | MerchantKit Admin" };

export default async function AnalyticsAdminPage({ searchParams }: AnalyticsAdminPageProps) {
  const params = await searchParams;
  const days = [7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 30;
  const report = await getAnalyticsDashboard(days);
  const metrics = [
    { label: "当前在线", value: report.totals.liveVisitors.toString(), hint: "最近 5 分钟有活动" },
    { label: "访客", value: report.totals.visitors.toString(), hint: `${days} 天去重访客` },
    { label: "访问次数", value: report.totals.sessions.toString(), hint: "30 分钟无活动后重新计次" },
    { label: "浏览量", value: report.totals.pageViews.toString(), hint: "已同意分析的页面浏览" },
    { label: "平均停留", value: formatDuration(report.totals.averageDurationSeconds), hint: "按访问计算" },
    { label: "跳出率", value: `${report.totals.bounceRate}%`, hint: "仅浏览一页的访问" },
  ];

  return (
    <AdminFrame active="analytics" metrics={metrics} title="数据分析" subtitle="只汇总访客明确同意后的真实访问数据；匿名分析与客户个人资料分开存储。">
      <section className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[#d8dde5] bg-white px-4 py-3">
          <div><p className="text-sm font-black">统计周期</p><p className="mt-1 text-xs font-bold text-[#697386]">数据从采集功能上线后开始记录，不补造历史记录。</p></div>
          <div className="flex gap-2">{[7, 30, 90].map((item) => <Link className={days === item ? "vk-button vk-button-dark min-h-10 px-4 text-xs" : "vk-button vk-button-light min-h-10 px-4 text-xs"} href={`/admin/analytics?days=${item}`} key={item}>{item} 天</Link>)}</div>
        </div>

        <section className="grid gap-4 xl:grid-cols-2">
          <DataPanel title="访问来源" note="X、小红书、搜索、直接访问与带 UTM 的推广来源。"><BarRows rows={report.sources} /></DataPanel>
          <DataPanel title="语言与市场" note="按访问者选择的中文站或英文站统计。"><BarRows rows={report.locales.map((row) => ({ ...row, label: formatLocale(row.label) }))} /></DataPanel>
          <DataPanel title="地区" note="仅在接入层提供国家/地区标头时记录；不使用 IP 反查精确地址。"><BarRows rows={report.countries} /></DataPanel>
          <DataPanel title="设备与浏览器" note="设备类型为粗粒度分类，不显示原始设备指纹。"><div className="grid gap-5 sm:grid-cols-2"><BarRows rows={report.devices} /><BarRows rows={report.browsers} /></div></DataPanel>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <DataPanel title="转化漏斗" note="按访问去重；支付成功只接受真实支付结果事件。"><Funnel rows={report.funnel.map((row) => ({ ...row, label: funnelLabel(row.label) }))} /></DataPanel>
          <DataPanel title="新访客与回访" note="当前统计周期内首次访问与此前已访问的用户。">
            <div className="grid grid-cols-2 gap-3"><Stat label="新访客" value={report.totals.newVisitors} /><Stat label="回访访客" value={report.totals.returningVisitors} /></div>
          </DataPanel>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <DataPanel title="热门页面" note="仅展示路径和浏览量，不混入姓名、手机号或地址。"><BarRows rows={report.topPages} /></DataPanel>
          <DataPanel title="热门商品" note="按商品浏览与选择事件聚合。"><BarRows rows={report.topProducts} /></DataPanel>
          <DataPanel title="组合偏好" note="选择过的单条、两条和三条组合。"><BarRows rows={report.preferences.packs} /></DataPanel>
          <DataPanel title="颜色与尺码偏好" note="基于选择行为，不代表最终支付订单。"><div className="grid gap-5 sm:grid-cols-2"><BarRows rows={report.preferences.colors} /><BarRows rows={report.preferences.sizes} /></div></DataPanel>
        </section>

        <section className="border border-[#d8dde5] bg-white p-5">
          <h2 className="text-base font-black">数据边界</h2>
          <div className="mt-3 grid gap-3 text-xs font-bold leading-5 text-[#697386] md:grid-cols-3">
            <p><strong className="block text-[#111827]">匿名访问</strong>页面、来源、设备类别和转化行为，仅在同意后采集。</p>
            <p><strong className="block text-[#111827]">客户资料</strong>客户手机号在授权后台完整展示，其他资料保持原有展示规则；姓名、手机号和收货地址不进入匿名访问分析。</p>
            <p><strong className="block text-[#111827]">设备识别</strong>只保存加密哈希和 90 天有效期，不保存可还原的原始指纹。</p>
          </div>
        </section>
      </section>
    </AdminFrame>
  );
}

function DataPanel({ children, note, title }: { children: React.ReactNode; note: string; title: string }) {
  return <section className="border border-[#d8dde5] bg-white p-5"><h2 className="text-base font-black">{title}</h2><p className="mt-1 text-xs font-bold leading-5 text-[#697386]">{note}</p><div className="mt-4">{children}</div></section>;
}

function BarRows({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  if (!rows.length) return <p className="rounded-[8px] bg-[#f8fafc] px-3 py-4 text-xs font-bold text-[#697386]">当前周期暂无已授权数据。</p>;
  return <div className="grid gap-3">{rows.map((row) => <div key={row.label}><div className="flex items-center justify-between gap-3 text-xs font-bold"><span className="truncate">{row.label}</span><span>{row.value}</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#eef1f5]"><div className="h-full rounded-full bg-[#155eef]" style={{ width: `${Math.max((row.value / max) * 100, 3)}%` }} /></div></div>)}</div>;
}

function Funnel({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(rows[0]?.value ?? 0, 1);
  return <div className="grid gap-2">{rows.map((row, index) => <div className="grid grid-cols-[120px_minmax(0,1fr)_44px] items-center gap-3" key={row.label}><span className="text-xs font-bold text-[#475467]">{row.label}</span><div className="h-8 overflow-hidden bg-[#eef1f5]"><div className="flex h-full min-w-[4px] items-center bg-[#111827]" style={{ width: `${Math.max((row.value / max) * 100, row.value ? 4 : 0)}%` }} /></div><span className="text-right text-xs font-black">{row.value}{index > 0 && rows[index - 1].value ? <small className="block text-[9px] text-[#697386]">{Math.round((row.value / rows[index - 1].value) * 100)}%</small> : null}</span></div>)}</div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-[8px] bg-[#f8fafc] p-4"><p className="text-xs font-bold text-[#697386]">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>; }
function formatDuration(seconds: number) { return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`; }
function formatLocale(value: string) { if (value === "en") return "英文站"; if (value === "zh-CN") return "中文站"; return "未知语言"; }
function funnelLabel(value: string) { return ({ product_view: "查看商品", select_pack: "选择组合", add_to_bag: "加入购物袋", begin_checkout: "开始结账", order_created: "创建订单", payment_success: "支付成功" } as Record<string, string>)[value] ?? value; }
