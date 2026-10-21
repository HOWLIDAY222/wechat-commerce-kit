import { NextResponse } from "next/server";
import { withStorefrontInformation } from "@/lib/services/storefront-information-service";
import {
  collectMediaAssetIds,
  getMediaAssetMap,
  getPublishedSitePage,
} from "@/lib/services/site-builder-service";

type MiniProgramPageRouteProps = {
  params: Promise<{ pageKey: string }>;
};

export async function GET(_request: Request, { params }: MiniProgramPageRouteProps) {
  const { pageKey } = await params;
  const result = await getPublishedSitePage(pageKey);

  if (!result || result.version.document.documentType !== "page") {
    return NextResponse.json({ ok: false, error: "MINIPROGRAM_PAGE_NOT_FOUND" }, { status: 404 });
  }

  const document = await withStorefrontInformation(pageKey, result.version.document, true);
  const assets = await getMediaAssetMap(collectMediaAssetIds(document));
  const imageWidths = contentImageWidths(pageKey, document);
  const response = NextResponse.json({
    ok: true,
    page: {
      key: result.page.key,
      name: result.page.name,
      path: result.page.path,
      template: result.page.template,
      version: result.version.versionNumber,
      publishedAt: "publishedAt" in result.version ? result.version.publishedAt : null,
      seo: {
        title: result.version.seoTitle,
        description: result.version.seoDescription,
        imageUrl: result.version.ogImageUrl,
      },
      document,
      assets: Object.fromEntries(
        [...assets].map(([id, asset]) => [id, {
          id: asset.id,
          url: miniProgramImageUrl(asset.url, imageWidths.get(id)),
          altText: asset.altText,
          name: asset.name,
        }]),
      ),
    },
  });

  response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return response;
}

// Resize only our public campaign/catalog photos. Never send private uploads or
// third-party URLs through the public image optimizer.
function miniProgramImageUrl(url: string, width = 750) {
  if (!/^\/assets\/(?:campaign|catalog)\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png)$/i.test(url) || url.split("/").includes("..")) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}

function contentImageWidths(pageKey: string, document: unknown) {
  const widths = new Map<string, number>();
  const sections = (document as { sections?: Record<string, unknown>[] })?.sections;
  if (!Array.isArray(sections)) return widths;
  const record = (id: unknown, width: number) => {
    if (typeof id === "string") widths.set(id, Math.max(widths.get(id) || 0, width));
  };
  for (const section of sections) {
    if (section.visible === false) continue;
    record(section.mediaAssetId, 750);
    const itemWidth = pageKey === "home" && Number(section.columns || 2) > 1 ? 384 : 750;
    if (Array.isArray(section.items)) for (const item of section.items) record(item.mediaAssetId, itemWidth);
    if (Array.isArray(section.slides)) for (const slide of section.slides) record(slide.mediaAssetId, 750);
  }
  return widths;
}
