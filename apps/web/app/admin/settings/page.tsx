import { PickupSettings } from './pickup-settings';
import { getPickupConfig } from '@/lib/services/offline-pickup-service';
import Link from "next/link";
import {getWeChatPayProviderStatus} from "@/lib/providers/wechat-pay";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { SettingsAdminForm } from "@/app/admin/settings/settings-admin-form";
import { WeChatLogisticsSettings } from "@/app/admin/settings/wechat-logistics-settings";
import { getLogisticsRule } from "@/lib/services/wechat-logistics-service";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { OFFICIAL_X_PROFILE_URL } from "@/lib/official-social";
import { listAdminAuditLogs, listAdminSettings } from "@/lib/services/admin-ops-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "运营设置 | MerchantKit Admin" };

export default async function SettingsAdminPage() {
  const session = await readCurrentAdminSession();
  const owner = session?.role === "owner";
  const [rows, auditLogs, databaseStatus, logisticsRule] = await Promise.all([
    listAdminSettings(),
    owner ? listAdminAuditLogs() : Promise.resolve([]),
    owner ? checkDatabaseStatus() : Promise.resolve("仅负责人可见"),
    owner ? getLogisticsRule() : Promise.resolve({ enabled: false, activatedAt: null }),
  ]);
  const pickupConfig = await getPickupConfig();
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return (
    <AdminFrame
      active="settings"
      metrics={[
        { label: "数据库", value: databaseStatus },
        { label: "存储模式", value: owner ? appConfig.COMMERCE_STORAGE : "受限" },
        { label: "支付服务", value: owner ? appConfig.PAYMENT_PROVIDER : "受限" },
        { label: "最近审计", value: owner ? `${auditLogs.length} 条` : "受限" },
      ]}
      title="店铺设置"
      subtitle="公开运营设置、系统状态、数据治理和审计记录统一归入这里；敏感信息只允许店铺负责人查看。"
    >
      <div className="grid gap-5">
        <nav className="flex flex-wrap gap-2 border border-[#d8dde5] bg-white p-3 text-xs font-black">
          <a className="vk-button vk-button-light min-h-10 px-4" href="#operations">运营设置</a>
          <a className="vk-button vk-button-light min-h-10 px-4" href="#pickup">线下自提</a>
          <a className="vk-button vk-button-light min-h-10 px-4" href="#status">系统状态</a>
          {owner ? <a className="vk-button vk-button-light min-h-10 px-4" href="#logistics">物流服务</a> : null}
          <a className="vk-button vk-button-light min-h-10 px-4" href="#data">数据与隐私</a>
          <a className="vk-button vk-button-light min-h-10 px-4" href="#audit">审计记录</a>
        </nav>
        <section className="scroll-mt-24" id="operations">
          <SettingsAdminForm initialSettings={{
            siteName: readSingleLine(settings.get("siteName"), "MerchantKit"),
            supportEmail: readEmail(settings.get("supportEmail")),
            supportPhone: readSingleLine(settings.get("supportPhone"), ""),
            xProfileUrl: readSingleLine(settings.get("xProfileUrl"), OFFICIAL_X_PROFILE_URL),
            shippingFeeCents: readNonNegativeInteger(settings.get("shippingFeeCents")),
            shippingRemoteFeeCents: readNonNegativeInteger(settings.get("shippingRemoteFeeCents")),
            shippingFarRemoteFeeCents: readNonNegativeInteger(settings.get("shippingFarRemoteFeeCents")),
          }} />
        </section>
        <PickupSettings initialConfig={pickupConfig} owner={owner} />
        {owner ? <WeChatLogisticsSettings initialRule={logisticsRule} /> : null}
        <section className="scroll-mt-24 border border-[#d8dde5] bg-white p-5" id="status">
          <h2 className="text-base font-black">系统状态</h2>
          {owner ? <div className="mt-4 grid gap-3 md:grid-cols-4"><Status label="数据库" value={databaseStatus} /><Status label="业务存储" value={appConfig.COMMERCE_STORAGE} /><Status label="官网支付渠道" value={appConfig.PAYMENT_PROVIDER} /><Status label="小程序微信支付配置" value={getWeChatPayProviderStatus().configured?"配置齐全；实际收款待交易验证":"配置不完整"} /><Status label="短信 / 邮件" value={`${appConfig.SMS_PROVIDER} / ${appConfig.EMAIL_PROVIDER}`} /></div> : <Restricted />}
          <p className="mt-4 text-xs font-bold leading-5 text-[#697386]">配置检查不代表真实付款、发货或退款已验收。这里仅显示健康状态和服务类型，不显示数据库地址、密钥、令牌或支付证书。</p>
        </section>
        <section className="scroll-mt-24 border border-[#d8dde5] bg-white p-5" id="data">
          <h2 className="text-base font-black">数据与隐私</h2>
          <div className="mt-4 grid gap-3 text-xs font-bold leading-5 text-[#697386] md:grid-cols-3">
            <Status label="匿名分析" value="明确同意后采集" /><Status label="设备识别" value="哈希化 / 90 天" /><Status label="客户资料" value="权限隔离 / 手机号完整" />
          </div>
          <p className="mt-4 text-xs font-bold leading-5 text-[#697386]">拒绝可选采集不会影响浏览或购买。姓名、手机号和收货地址来自账户、结账与订单，不写入匿名访问事件；删除与导出请求应由负责人留痕处理。</p>
        </section>
        <section className="scroll-mt-24 border border-[#d8dde5] bg-white p-5" id="audit">
          <h2 className="text-base font-black">审计记录</h2>{owner&&<Link className="vk-admin-link mt-3" href="/admin/audit">搜索记录 / 查看操作详情</Link>}
          {!owner ? <Restricted /> : <div className="mt-4 grid gap-2">{auditLogs.slice(0, 50).map((entry) => <div className="grid gap-1 rounded-[8px] bg-[#f8fafc] px-3 py-3 text-xs font-bold sm:grid-cols-[150px_220px_minmax(0,1fr)]" key={entry.id}><span className="text-[#697386]">{formatDate(entry.createdAt)}</span><span>{entry.action}</span><span className="break-all text-[#697386]">{entry.targetType}{entry.targetId ? ` / ${entry.targetId}` : ""}</span></div>)}{auditLogs.length === 0 ? <p className="text-xs font-bold text-[#697386]">暂无审计记录。</p> : null}</div>}
        </section>
      </div>
    </AdminFrame>
  );
}

function Status({ label, value }: { label: string; value: string }) { return <div className="rounded-[8px] bg-[#f8fafc] p-4"><p className="text-xs font-bold text-[#697386]">{label}</p><p className="mt-1 text-sm font-black">{value}</p></div>; }
function Restricted() { return <p className="mt-4 rounded-[8px] bg-[#fff7ed] px-4 py-3 text-xs font-black text-[#9a3412]">此区域仅店铺负责人可见。</p>; }
async function checkDatabaseStatus() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return "本机临时存储";
  try { await prisma.$queryRaw`SELECT 1`; return "正常"; } catch { return "异常"; }
}
function formatDate(value: Date | string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

function readSingleLine(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  return value.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? fallback;
}

function readEmail(value: unknown) {
  const candidate = readSingleLine(value, "");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : "";
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
