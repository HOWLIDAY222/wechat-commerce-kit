import Link from "next/link";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { englishInfoPageKeys } from "@/lib/english-storefront-content";
import { getConfiguredXProfileUrl, internationalMarket } from "@/lib/international-market";
import { getPublicSiteSettings } from "@/lib/services/public-site-settings-service";
import { listMediaAssets, listSiteBuilderPages } from "@/lib/services/site-builder-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "网站装修管理 | MerchantKit 后台" };

export default async function DesignWorkspacePage() {
  const [pages, assets, publicSettings] = await Promise.all([listSiteBuilderPages(), listMediaAssets(), getPublicSiteSettings()]);
  const xProfileUrl = publicSettings.xProfileUrl || getConfiguredXProfileUrl();
  const contentPages = pages.filter((page) => page.kind === "HOME" || page.kind === "CONTENT");
  const unpublished = pages.filter((page) => page.draft && page.published?.publishedAt && page.draft.updatedAt > page.published.publishedAt).length;
  const frameMetrics = [
    { label: "可装修页面", value: contentPages.length.toString(), hint: "包含首页、内容页和政策页" },
    { label: "当前草稿", value: pages.filter((page) => page.draft).length.toString(), hint: "草稿不会自动影响前台" },
    { label: "待发布", value: unpublished.toString(), hint: "保存后需预览并发布" },
    { label: "可用素材", value: assets.length.toString(), hint: "页面与商品统一从素材库选择" },
  ];

  return (
    <AdminFrame active="design" metrics={frameMetrics} title="装修概览" subtitle="选择页面和板块，修改图片、文字、按钮、链接、排序和关联商品；前台只读取已发布版本。">
      <section className="mb-4 border border-[#d8dde5] bg-white">
        <div className="border-b border-[#e4e7ec] px-5 py-4">
          <p className="text-xs font-black text-[#155eef]">语言与市场</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">英文站已启用</h2><Link className="text-xs font-black text-[#155eef] hover:underline" href="/en" target="_blank">打开 /en</Link></div>
        </div>
        <dl className="grid divide-y divide-[#eef1f5] text-sm md:grid-cols-4 md:divide-x md:divide-y-0">
          <MarketStatus label="英文公开页面" value={`${englishInfoPageKeys.length + 3} 个`} ready />
          <MarketStatus label="X 账号链接" value={xProfileUrl ? "已配置" : "待配置真实地址"} ready={Boolean(xProfileUrl)} />
          <MarketStatus label="海外支付" value={internationalMarket.paymentEnabled ? "已启用" : "关闭"} ready={internationalMarket.paymentEnabled} />
          <MarketStatus label="海外配送与结账" value={internationalMarket.checkoutEnabled && internationalMarket.shippingEnabled ? "已启用" : "关闭"} ready={internationalMarket.checkoutEnabled && internationalMarket.shippingEnabled} />
        </dl>
        <p className="border-t border-[#eef1f5] px-5 py-3 text-xs font-bold leading-5 text-[#697386]">语言、市场、币种和支付相互独立。当前英文站只提供商品与品牌信息，不会进入国内结账，也不会收取海外付款。</p>
      </section>
      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="border border-[#d8dde5] bg-white">
          <div className="border-b border-[#e4e7ec] px-5 py-4">
            <p className="text-xs font-black text-[#155eef]">页面装修</p>
            <h2 className="mt-1 text-xl font-black">选择要维护的页面</h2>
          </div>
          <div className="divide-y divide-[#eef1f5]">
            {contentPages.map((page) => (
              <Link className="grid gap-3 px-5 py-4 transition hover:bg-[#f8fafc] md:grid-cols-[1fr_auto] md:items-center" href={`/admin/design/pages/${page.key}`} key={page.id}>
                <div>
                  <p className="text-sm font-black">{page.name}</p>
                  <p className="mt-1 text-xs font-bold text-[#697386]">{page.path} · {page.template === "HOME" ? "首页板块" : page.template === "CATALOG" ? "商城页面" : "内容板块"}</p>
                </div>
                <span className="text-xs font-black text-[#155eef]">进入装修</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid content-start gap-3">
          <QuickLink href="/admin/design/pages/header" label="顶部导航" detail="菜单只关联现有页面，可调整名称、顺序和筛选参数。" />
          <QuickLink href="/admin/design/pages/footer" label="页脚与官方渠道" detail="维护品牌文案、栏目、站内链接和社媒账号。" />
          <QuickLink href="/admin/design/media" label="素材库" detail="先上传并整理图片，再在页面或商品中选择。" />
          <QuickLink href="/admin/design/versions" label="发布与版本" detail="查看草稿、已发布版本和历史版本，支持恢复到草稿。" />
        </div>
      </section>
    </AdminFrame>
  );
}

function MarketStatus({ label, ready, value }: { label: string; ready: boolean; value: string }) {
  return <div className="px-5 py-4"><dt className="text-xs font-black text-[#697386]">{label}</dt><dd className={`mt-2 text-sm font-black ${ready ? "text-[#027a48]" : "text-[#b54708]"}`}>{value}</dd></div>;
}

function QuickLink({ detail, href, label }: { detail: string; href: string; label: string }) {
  return (
    <Link className="block border border-[#d8dde5] bg-white px-5 py-4 transition hover:border-[#155eef]" href={href}>
      <strong className="text-sm font-black">{label}</strong>
      <p className="mt-2 text-xs font-bold leading-5 text-[#697386]">{detail}</p>
    </Link>
  );
}
