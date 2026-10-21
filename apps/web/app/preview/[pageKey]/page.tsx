import { BrandLogo } from "@/components/brand-logo";
import { redirect } from "next/navigation";
import { Eye } from "lucide-react";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { ManagedPage } from "@/components/site-builder/managed-page";
import { getDraftSitePage } from "@/lib/services/site-builder-service";
import { resolvePageHref, sitePageDefinitions } from "@/lib/site-builder";

export const dynamic = "force-dynamic";
export const metadata = { title: "装修草稿预览", robots: { index: false, follow: false } };
type PreviewProps = { params: Promise<{ pageKey: string }> };

export default async function SiteDraftPreviewPage({ params }: PreviewProps) {
  const session = await readCurrentAdminSession();
  const { pageKey } = await params;
  if (!session) redirect(`/admin/login?next=${encodeURIComponent(`/preview/${pageKey}`)}`);
  const draft = await getDraftSitePage(pageKey);
  const chrome = draft?.version.document;
  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 z-50 flex min-h-11 items-center justify-center gap-2 bg-[#101828] px-4 text-center text-xs font-black text-white"><Eye className="h-4 w-4" />装修草稿预览 · 尚未发布</div>
      {chrome?.documentType === "header" ? <HeaderDraftPreview document={chrome} /> : null}
      {chrome?.documentType === "footer" ? <FooterDraftPreview document={chrome} /> : null}
      {chrome?.documentType === "page" ? <ManagedPage pageKey={pageKey} preview /> : null}
    </div>
  );
}

function HeaderDraftPreview({ document }: { document: Extract<NonNullable<Awaited<ReturnType<typeof getDraftSitePage>>>["version"]["document"], { documentType: "header" }> }) {
  return <div className="min-h-[70vh] bg-[#f7f9fc] pt-16"><header className="border-y border-line bg-white"><div className="vk-container flex min-h-16 items-center gap-8"><BrandLogo /><nav className="flex flex-wrap gap-6">{document.items.map((item, index) => <a className="text-sm font-black" href={resolvePageHref(item, sitePageDefinitions)} key={`${item.pageKey}-${index}`}>{item.label}</a>)}</nav></div></header></div>;
}

function FooterDraftPreview({ document }: { document: Extract<NonNullable<Awaited<ReturnType<typeof getDraftSitePage>>>["version"]["document"], { documentType: "footer" }> }) {
  return <div className="grid min-h-[70vh] content-end bg-[#f7f9fc]"><footer className="border-t border-line bg-white"><div className="vk-container grid gap-8 py-10 md:grid-cols-[1.2fr_repeat(3,0.8fr)]"><div><BrandLogo /><p className="mt-3 text-sm font-bold leading-7 text-muted">{document.brandText}</p><p className="mt-4 text-xs font-bold text-muted">{document.socialChannels.filter((item) => item.visible).map((item) => item.label).join(" / ")}</p></div>{document.columns.map((column) => <nav className="grid content-start gap-2" key={column.id}><strong>{column.title}</strong>{column.links.map((link, index) => <a className="text-sm font-bold text-muted" href={resolvePageHref(link, sitePageDefinitions)} key={`${link.pageKey}-${index}`}>{link.label}</a>)}</nav>)}</div></footer></div>;
}
