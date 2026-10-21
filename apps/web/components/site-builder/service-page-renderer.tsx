import { BrandStoryPage } from "@/components/brand-story-page";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { resolvePageHref, type CardGridSection, type HeroSection, type PageDocument } from "@/lib/site-builder";

import { X1SizeTable } from "@/components/product/x1-size-table";

type Asset = { id: string; url: string; altText: string | null; name: string };
type Page = { key: string; path: string | null };

type ServicePageRendererProps = {
  assets: Map<string, Asset>;
  document: PageDocument;
  extension?: ReactNode;
  pageKey: string;
  pages: Page[];
};

type NavigationItem = readonly [key: string, label: string];

const navigationGroups: ReadonlyArray<{ label: string; items: ReadonlyArray<NavigationItem> }> = [
  {
    label: "选购",
    items: [
      ["shopping-guide", "选购帮助"],
      ["size-guide", "尺码指南"],
    ],
  },
  {
    label: "订单服务",
    items: [
      ["shipping-policy", "配送方式"],
      ["payment-methods", "支付方式"],
      ["return-policy", "退换货政策"],
      ["after-sales-process", "售后流程"],
      ["after-sales-policy", "售后政策"],
      ["faq", "常见问题"],
      ["contact", "联系我们"],
    ],
  },
  {
    label: "品牌与规则",
    items: [
      ["about", "品牌故事"],
      ["official-channels", "官方渠道"],
      ["privacy-policy", "隐私政策"],
      ["miniprogram-privacy", "小程序隐私说明"],
      ["terms", "服务条款"],
    ],
  },
] as const;

const servicePageKeys = new Set(navigationGroups.flatMap((group) => group.items.map(([key]) => key)));
const legalPageKeys = new Set(["privacy-policy", "miniprogram-privacy", "terms"]);

export function isServicePageKey(pageKey: string) {
  return servicePageKeys.has(pageKey);
}

export function ServicePageRenderer({ assets, document, extension, pageKey, pages }: ServicePageRendererProps) {
  const sections = [...document.sections].sort((a, b) => a.sortOrder - b.sortOrder).filter((section) => section.visible);
  const hero = sections.find((section): section is HeroSection => section.type === "hero");
  const contentSections = sections.filter((section): section is CardGridSection => section.type === "contentGrid" || section.type === "cardGrid");
  const heroAsset = hero?.mediaAssetId ? assets.get(hero.mediaAssetId) : null;
  const isLegal = legalPageKeys.has(pageKey);
  if (pageKey === "about") return <BrandStoryPage title={hero?.title || "品牌故事"} tagline={hero?.body || ""}
    sections={contentSections.flatMap(section => section.items.map(item => ({ title: item.title, paragraphs: item.body.split("\n\n") })))} />;


  return (
    <main className={`vk-storefront service-page ${isLegal ? "legal-page" : ""}`}>
      {hero ? <ServiceHero asset={heroAsset} hero={hero} /> : null}


      <div className="vk-container pb-16 pt-6 md:pb-20 md:pt-10">
        <MobileServiceNavigation activeKey={pageKey} pages={pages} />
        <div className={`grid gap-10 lg:grid-cols-[216px_minmax(0,1fr)] lg:gap-16 ${isLegal ? "xl:grid-cols-[216px_minmax(0,920px)]" : ""}`}>
          <DesktopServiceNavigation activeKey={pageKey} pages={pages} />
          <article className="min-w-0">
            {pageKey === "size-guide" ? <SizeGuideTable /> : null}
            {pageKey === "privacy-policy" ? <PrivacyPolicyIndex sections={contentSections} /> : null}
            {contentSections.map((section) => (
              <ServiceContentSection key={section.id} pageKey={pageKey} pages={pages} section={section} />
            ))}
            {extension}
          </article>
        </div>
      </div>
    </main>
  );
}

function ServiceHero({ asset, hero }: { asset: Asset | null | undefined; hero: HeroSection }) {
  return (
    <header className="service-heading" id={hero.id}>
      <div className={`vk-container ${asset ? "grid items-stretch md:grid-cols-[minmax(0,1fr)_minmax(320px,0.78fr)]" : ""}`}>
        <div className="max-w-3xl py-8 md:py-10">

          <h1 className="text-[30px] leading-tight text-black md:text-[40px]">{hero.title}</h1>
          <p className="mt-4 max-w-2xl whitespace-pre-line text-sm leading-7 text-black/65">{hero.body}</p>
        </div>
        {asset ? (
          <div className="relative min-h-[280px] md:min-h-[300px]">
            <Image alt={asset.altText || asset.name} className="object-cover" fill priority sizes="(min-width: 768px) 44vw, 100vw" src={asset.url} />
          </div>
        ) : null}
      </div>
    </header>
  );
}

function MobileServiceNavigation({ activeKey, pages }: { activeKey: string; pages: Page[] }) {
  return <details className="service-mobile-nav mb-8 border-y border-line lg:hidden">
    <summary className="cursor-pointer py-4 text-sm">帮助目录 · {navigationGroups.flatMap((group) => group.items).find(([key]) => key === activeKey)?.[1]}</summary>
    <nav aria-label="服务页面" className="grid grid-cols-2 gap-x-5 pb-4">{navigationGroups.flatMap((group) => group.items).map(([key, label]) => <Link key={key} href={resolvePageHref({ pageKey: key }, pages)} aria-current={key === activeKey ? "page" : undefined} className="py-3 text-sm">{label}</Link>)}</nav>
  </details>;
}

function DesktopServiceNavigation({ activeKey, pages }: { activeKey: string; pages: Page[] }) {
  return (
    <aside className="hidden lg:block">
      <nav aria-label="服务页面" tabIndex={0} className="vk-service-sidebar sticky top-28 space-y-8">
        {navigationGroups.map((group) => (
          <div key={group.label}>
            <p className="mb-3 text-xs font-semibold text-black/40">{group.label}</p>
            <div className="grid border-t border-line">
              {group.items.map(([key, label]) => (
                <Link
                  aria-current={key === activeKey ? "page" : undefined}
                  className={`border-b border-line py-3 text-sm ${key === activeKey ? "font-semibold text-black" : "text-black/55 hover:text-black"}`}
                  href={resolvePageHref({ pageKey: key }, pages)}
                  key={key}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function ServiceContentSection({ pageKey, pages, section }: { pageKey: string; pages: Page[]; section: CardGridSection }) {
  if (pageKey === "faq") {
    return (
      <section className="mb-12" id={section.id}>
        {section.title ? <h2 className="mb-5 text-[26px] font-semibold">{section.title}</h2> : null}
        <div className="border-t border-black">
          {section.items.map((item) => (
            <details className="group border-b border-line" key={item.id}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-5 text-base font-semibold">
                {item.title}
                <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <p className="max-w-3xl pb-6 text-sm leading-7 text-black/65">{item.body}</p>
            </details>
          ))}
        </div>
      </section>
    );
  }

  if (pageKey === "after-sales-process") {
    return (
      <section className="mb-12" id={section.id}>
        {section.title ? <h2 className="mb-5 text-[26px] font-semibold">{section.title}</h2> : null}
        <ol className="border-t border-black">
          {section.items.map((item, index) => (
            <li className="grid gap-3 border-b border-line py-6 sm:grid-cols-[52px_180px_minmax(0,1fr)] sm:gap-6" key={item.id}>
              <span className="text-sm text-black/40">{String(index + 1).padStart(2, "0")}</span>
              <h2 className="text-lg font-semibold">{stripStepNumber(item.title)}</h2>
              <p className="text-sm leading-7 text-black/65">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const isLegal = legalPageKeys.has(pageKey);
  return (
    <section className={`${isLegal ? "mb-14 scroll-mt-28" : "mb-12"}`} id={section.id}>
      {section.title ? <h2 className={`${isLegal ? "mb-6 text-[28px]" : "mb-5 text-[26px]"} font-semibold`}>{section.title}</h2> : null}
      <div className="border-t border-black">
        {section.items.map((item) => (
          <section className={`border-b border-line py-6 ${isLegal ? "md:py-8" : "grid gap-3 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8"}`} key={item.id}>
            {item.table ? <LegalTable table={item.table} /> : (
              <>
                <h3 className={`${isLegal ? "text-lg md:text-xl" : "text-lg"} font-semibold`}>{item.title}</h3>
                <div>
                  {isLegal ? <LegalBody body={item.body} /> : <p className="whitespace-pre-line text-sm leading-7 text-black/65 md:text-[15px]">{item.body}</p>}
                  {item.link ? (
                    <Link className="mt-4 inline-flex border-b border-black pb-0.5 text-sm font-semibold" href={resolvePageHref(item.link, pages)}>
                      {item.link.label}
                    </Link>
                  ) : null}
                </div>
              </>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function LegalBody({ body }: { body: string }) {
  return (
    <div className="space-y-3 text-sm leading-7 text-black/70 md:text-[15px]">
      {body.split("\n").filter(Boolean).map((line, index) => {
        if (line.startsWith("§ ")) {
          return <h4 className="pb-1 pt-3 text-base font-semibold text-black" key={`${index}-${line}`}>{line.slice(2)}</h4>;
        }
        if (line.startsWith("! ")) {
          return <p className="border-l-2 border-black pl-4 font-semibold text-black" key={`${index}-${line}`}>{line.slice(2)}</p>;
        }
        if (line.startsWith("• ")) {
          return (
            <div className="grid grid-cols-[12px_minmax(0,1fr)] gap-2" key={`${index}-${line}`}>
              <span aria-hidden="true">•</span>
              <p>{line.slice(2)}</p>
            </div>
          );
        }
        return <p className="whitespace-pre-line" key={`${index}-${line}`}>{line}</p>;
      })}
    </div>
  );
}

function LegalTable({ table }: { table: NonNullable<CardGridSection["items"][number]["table"]> }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-left text-sm leading-6">
        <thead>
          <tr className="border-b border-black">
            {table.headers.map((header, index) => <th className="px-4 py-3 font-semibold first:pl-0" key={`${index}-${header}`}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr className="border-b border-line align-top" key={rowIndex}>
              {row.map((cell, cellIndex) => <td className="px-4 py-4 text-black/70 first:pl-0" key={`${cellIndex}-${cell}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrivacyPolicyIndex({ sections }: { sections: CardGridSection[] }) {
  return (
    <nav aria-label="隐私政策目录" className="mb-14 border-y border-black py-6">
      <p className="text-xs font-semibold text-black/45">目录</p>
      <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {sections.map((section) => (
          <Link className="text-sm font-semibold text-black/70 hover:text-black hover:underline" href={`#${section.id}`} key={section.id}>
            {section.title}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function SizeGuideTable() {
  return <section className="mb-12" aria-label="X1 Air 尺码表"><X1SizeTable /><Link href="/contact" className="mt-4 inline-block text-sm underline underline-offset-4">联系咨询</Link></section>;
}

function stripStepNumber(value: string) {
  return value.replace(/^\d+[.、]\s*/, "");
}
