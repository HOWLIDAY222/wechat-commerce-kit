import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { applyCurrentBrandAssetUrl, applyCurrentBrandName, applyCurrentBrandToValue, BRAND_NAME, BRAND_SHARE_IMAGE } from "@/lib/brand";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import {
  buildDefaultSiteDocument,
  parseSiteDocument,
  resolvePageHref,
  sitePageDefinitions,
  type PageLink,
  type SiteDocument,
} from "@/lib/site-builder";
import { normalizeUploadedImage } from "@/lib/uploads/image";
import { isActiveSaleProduct } from "@/lib/storefront-visibility";

const systemActor = "system-site-builder";
const maxMediaBytes = 8 * 1024 * 1024;
const builtInAssets = [
  { id: "media-system-logo", name: `${BRAND_NAME} 默认分享图`, url: BRAND_SHARE_IMAGE, mimeType: "image/webp", altText: `${BRAND_NAME} X1 Air White 商品展示` },
] as const;
const builtInShareImageUrl = BRAND_SHARE_IMAGE;

let bootstrapPromise: Promise<void> | null = null;

type RuntimeSiteVersion = {
  id: string;
  pageId: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  document: SiteDocument;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  changeNote: string | null;
  createdById: string;
  publishedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

type RuntimeSitePage = {
  id: string;
  key: string;
  name: string;
  path: string | null;
  kind: "HOME" | "CONTENT" | "HEADER" | "FOOTER";
  template: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  versions: RuntimeSiteVersion[];
};

type RuntimeMediaAsset = {
  id: string;
  name: string;
  url: string;
  altText: string | null;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  width: number | null;
  height: number | null;
  status: "ACTIVE" | "ARCHIVED";
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

const runtimeGlobal = globalThis as typeof globalThis & {
  __merchantkitSiteBuilderPages?: Map<string, RuntimeSitePage>;
  __merchantkitMediaAssets?: Map<string, RuntimeMediaAsset>;
};
const runtimePages = runtimeGlobal.__merchantkitSiteBuilderPages ?? new Map<string, RuntimeSitePage>();
const runtimeMedia = runtimeGlobal.__merchantkitMediaAssets ?? new Map<string, RuntimeMediaAsset>();
runtimeGlobal.__merchantkitSiteBuilderPages = runtimePages;
runtimeGlobal.__merchantkitMediaAssets = runtimeMedia;

export async function ensureSiteBuilderBootstrap() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    await bootstrapRuntimeSiteBuilder();
    return;
  }
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapSiteBuilder().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  await bootstrapPromise;
}

async function bootstrapRuntimeSiteBuilder() {
  if (runtimePages.size > 0) return;
  const now = new Date();
  const { listAdminProducts } = await import("@/lib/services/admin-catalog-service");
  const offeredProductIds = (await listAdminProducts()).filter(isActiveSaleProduct).map((product) => product.id);
  for (const asset of builtInAssets) {
    runtimeMedia.set(asset.id, {
      ...asset,
      altText: asset.altText,
      sizeBytes: 0,
      checksum: null,
      width: null,
      height: null,
      status: "ACTIVE",
      createdById: systemActor,
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const definition of sitePageDefinitions) {
    const id = `runtime-site-page-${definition.key}`;
    const document = buildDefaultSiteDocument(definition.key, offeredProductIds);
    const published: RuntimeSiteVersion = {
      id: `${id}-v1`, pageId: id, versionNumber: 1, status: "PUBLISHED", document,
      seoTitle: definition.seoTitle ?? definition.name,
      seoDescription: definition.seoDescription ?? "",
      ogImageUrl: builtInShareImageUrl,
      changeNote: "本地预览初始版本",
      createdById: systemActor,
      publishedById: systemActor,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    };
    const draft: RuntimeSiteVersion = {
      ...published,
      id: `${id}-v2`,
      versionNumber: 2,
      status: "DRAFT",
      document: structuredClone(document),
      changeNote: "当前装修草稿",
      publishedById: null,
      publishedAt: null,
    };
    runtimePages.set(definition.key, {
      id, key: definition.key, name: definition.name, path: definition.path, kind: definition.kind,
      template: definition.template, sortOrder: definition.sortOrder, createdAt: now, updatedAt: now, versions: [draft, published],
    });
  }
}

async function bootstrapSiteBuilder() {
  await Promise.all(builtInAssets.map((asset) => prisma.mediaAsset.upsert({
    where: { id: asset.id },
    update: { name: asset.name, url: asset.url, altText: asset.altText, mimeType: asset.mimeType, status: "ACTIVE" },
    create: { ...asset, sizeBytes: 0, createdById: systemActor },
  })));

  const pages = [];
  for (const definition of sitePageDefinitions) {
    pages.push(await prisma.sitePage.upsert({
      where: { key: definition.key },
      update: { name: definition.name, path: definition.path, kind: definition.kind, template: definition.template, sortOrder: definition.sortOrder },
      create: { key: definition.key, name: definition.name, path: definition.path, kind: definition.kind, template: definition.template, sortOrder: definition.sortOrder },
    }));
  }
  const pageMap = new Map(pages.map((page) => [page.key, page]));
  const offeredProductIds = (await prisma.product.findMany({
    where: { status: "ACTIVE", saleMode: { in: ["PREORDER", "IN_STOCK"] } },
    select: { id: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  })).map((product) => product.id);

  for (const definition of sitePageDefinitions) {
    const page = pageMap.get(definition.key);
    if (!page) continue;
    const existing = await prisma.sitePageVersion.count({ where: { pageId: page.id } });
    if (existing > 0) continue;

    const document = buildDefaultSiteDocument(definition.key, offeredProductIds);
    const seoTitle = definition.seoTitle || definition.name;
    const seoDescription = definition.seoDescription || "";
    const ogImageUrl = builtInShareImageUrl;
    const now = new Date();

    await prisma.$transaction([
      prisma.sitePageVersion.create({
        data: {
          pageId: page.id,
          versionNumber: 1,
          status: "PUBLISHED",
          document: toJson(document),
          seoTitle,
          seoDescription,
          ogImageUrl,
          changeNote: "从现有网站内容初始化",
          createdById: systemActor,
          publishedById: systemActor,
          publishedAt: now,
        },
      }),
      prisma.sitePageVersion.create({
        data: {
          pageId: page.id,
          versionNumber: 2,
          status: "DRAFT",
          document: toJson(document),
          seoTitle,
          seoDescription,
          ogImageUrl,
          changeNote: "当前装修草稿",
          createdById: systemActor,
        },
      }),
    ]);
  }
}

export async function listSiteBuilderPages() {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return [...runtimePages.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((page) => ({
      ...page,
      versions: page.versions.map((version) => presentSiteVersion(version)),
      draft: presentOptionalSiteVersion(page.versions.find((version) => version.status === "DRAFT")),
      published: presentOptionalSiteVersion(page.versions.find((version) => version.status === "PUBLISHED")),
    }));
  }
  const pages = await prisma.sitePage.findMany({
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 10 } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return pages.map((page) => {
    const versions = page.versions.map((version) => presentSiteVersion({ ...version, document: parseSiteDocument(version.document) }));
    return {
      ...page,
      versions,
      draft: versions.find((version) => version.status === "DRAFT") ?? null,
      published: versions.find((version) => version.status === "PUBLISHED") ?? null,
    };
  });
}

export async function getSiteBuilderPage(pageKey: string) {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const page = runtimePages.get(pageKey);
    if (!page) return null;
    const versions = page.versions.map((version) => presentSiteVersion(version));
    return {
      ...page,
      versions,
      draft: versions.find((version) => version.status === "DRAFT") ?? null,
      published: versions.find((version) => version.status === "PUBLISHED") ?? null,
    };
  }
  const page = await prisma.sitePage.findUnique({
    where: { key: pageKey },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!page) return null;
  const versions = page.versions.map((version) => presentSiteVersion({ ...version, document: parseSiteDocument(version.document) }));
  return {
    ...page,
    versions,
    draft: versions.find((version) => version.status === "DRAFT") ?? null,
    published: versions.find((version) => version.status === "PUBLISHED") ?? null,
  };
}

export async function getPublishedSitePage(pageKey: string) {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const page = runtimePages.get(pageKey);
    const version = page?.versions.find((item) => item.status === "PUBLISHED");
    return page && version ? { page, version: presentSiteVersion(version) } : getRuntimeDefaultPage(pageKey);
  }
  const page = await prisma.sitePage.findUnique({
    where: { key: pageKey },
    include: { versions: { where: { status: "PUBLISHED" }, orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  const version = page?.versions[0];
  if (!page || !version) return getRuntimeDefaultPage(pageKey);
  return { page, version: presentSiteVersion({ ...version, document: parseSiteDocument(version.document) }) };
}

export async function getDraftSitePage(pageKey: string) {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const page = runtimePages.get(pageKey);
    const version = page?.versions.find((item) => item.status === "DRAFT");
    return page && version ? { page, version: presentSiteVersion(version) } : null;
  }
  const page = await prisma.sitePage.findUnique({
    where: { key: pageKey },
    include: { versions: { where: { status: "DRAFT" }, orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  const version = page?.versions[0];
  if (!page || !version) return null;
  return { page, version: presentSiteVersion({ ...version, document: parseSiteDocument(version.document) }) };
}

function presentOptionalSiteVersion<T extends { document: SiteDocument; ogImageUrl: string | null; seoDescription: string | null; seoTitle: string | null; changeNote?: string | null }>(version: T | undefined) {
  return version ? presentSiteVersion(version) : null;
}

function presentSiteVersion<T extends { document: SiteDocument; ogImageUrl: string | null; seoDescription: string | null; seoTitle: string | null; changeNote?: string | null }>(version: T): T {
  return {
    ...version,
    changeNote: version.changeNote ? applyCurrentBrandName(version.changeNote) : version.changeNote,
    document: applyCurrentBrandToValue(version.document),
    ogImageUrl: applyCurrentBrandAssetUrl(version.ogImageUrl),
    seoDescription: version.seoDescription ? applyCurrentBrandName(version.seoDescription) : null,
    seoTitle: version.seoTitle ? applyCurrentBrandName(version.seoTitle) : null,
  };
}

export async function saveSiteBuilderDraft(pageKey: string, input: {
  document: unknown;
  seoTitle?: string;
  seoDescription?: string;
  ogImageUrl?: string;
  changeNote?: string;
}, actorId: string) {
  await ensureSiteBuilderBootstrap();
  const document = parseSiteDocument(applyCurrentBrandToValue(input.document));
  const seoTitle = cleanBrandedOptional(input.seoTitle, 160);
  const seoDescription = cleanBrandedOptional(input.seoDescription, 360);
  const ogImageUrl = applyCurrentBrandAssetUrl(cleanOptional(input.ogImageUrl, 500));
  const changeNote = cleanBrandedOptional(input.changeNote, 240);
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const page = runtimePages.get(pageKey);
    const draft = page?.versions.find((version) => version.status === "DRAFT");
    if (!page) throw new Error("SITE_PAGE_NOT_FOUND");
    if (!draft) throw new Error("SITE_DRAFT_NOT_FOUND");
    assertDocumentMatchesPage(page.kind, document);
    await assertRuntimeDocumentReferences(document);
    Object.assign(draft, {
      document: structuredClone(document),
      seoTitle: seoTitle ?? null,
      seoDescription: seoDescription ?? null,
      ogImageUrl,
      changeNote: changeNote ?? null,
      createdById: actorId,
      updatedAt: new Date(),
    });
    page.updatedAt = new Date();
    return draft;
  }
  const page = await prisma.sitePage.findUnique({ where: { key: pageKey } });
  if (!page) throw new Error("SITE_PAGE_NOT_FOUND");
  assertDocumentMatchesPage(page.kind, document);
  await assertDocumentReferences(document);
  const draft = await prisma.sitePageVersion.findFirst({ where: { pageId: page.id, status: "DRAFT" }, orderBy: { versionNumber: "desc" } });
  if (!draft) throw new Error("SITE_DRAFT_NOT_FOUND");
  const updated = await prisma.sitePageVersion.update({
    where: { id: draft.id },
    data: {
      document: toJson(document),
      seoTitle,
      seoDescription,
      ogImageUrl,
      changeNote,
      createdById: actorId,
    },
  });
  await writeAudit(actorId, "admin.site.draft.saved", "site_page", page.id, { pageKey, versionNumber: draft.versionNumber });
  return { ...updated, document };
}

export async function publishSiteBuilderDraft(pageKey: string, actorId: string) {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const page = runtimePages.get(pageKey);
    const draft = page?.versions.find((version) => version.status === "DRAFT");
    if (!page) throw new Error("SITE_PAGE_NOT_FOUND");
    if (!draft) throw new Error("SITE_DRAFT_NOT_FOUND");
    Object.assign(draft, presentSiteVersion(draft));
    for (const version of page.versions) if (version.status === "PUBLISHED") version.status = "ARCHIVED";
    draft.status = "PUBLISHED";
    draft.publishedById = actorId;
    draft.publishedAt = new Date();
    draft.updatedAt = new Date();
    const nextNumber = Math.max(...page.versions.map((version) => version.versionNumber)) + 1;
    const nextDraft: RuntimeSiteVersion = {
      ...draft,
      id: `${page.id}-v${nextNumber}`,
      versionNumber: nextNumber,
      status: "DRAFT",
      document: structuredClone(draft.document),
      changeNote: `基于已发布版本 v${draft.versionNumber}`,
      createdById: actorId,
      publishedById: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    page.versions.unshift(nextDraft);
    return { published: draft, nextDraft };
  }
  return prisma.$transaction(async (tx) => {
    const page = await tx.sitePage.findUnique({ where: { key: pageKey } });
    if (!page) throw new Error("SITE_PAGE_NOT_FOUND");
    const draft = await tx.sitePageVersion.findFirst({ where: { pageId: page.id, status: "DRAFT" }, orderBy: { versionNumber: "desc" } });
    if (!draft) throw new Error("SITE_DRAFT_NOT_FOUND");
    const sanitizedDraft = presentSiteVersion({ ...draft, document: parseSiteDocument(draft.document) });
    assertDocumentMatchesPage(page.kind, sanitizedDraft.document);

    await tx.sitePageVersion.updateMany({ where: { pageId: page.id, status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
    const published = await tx.sitePageVersion.update({
      where: { id: draft.id },
      data: {
        status: "PUBLISHED",
        document: toJson(sanitizedDraft.document),
        seoTitle: sanitizedDraft.seoTitle,
        seoDescription: sanitizedDraft.seoDescription,
        ogImageUrl: sanitizedDraft.ogImageUrl,
        changeNote: sanitizedDraft.changeNote,
        publishedById: actorId,
        publishedAt: new Date(),
      },
    });
    const nextNumber = (await tx.sitePageVersion.aggregate({ where: { pageId: page.id }, _max: { versionNumber: true } }))._max.versionNumber ?? draft.versionNumber;
    const nextDraft = await tx.sitePageVersion.create({
      data: {
        pageId: page.id,
        versionNumber: nextNumber + 1,
        status: "DRAFT",
        document: toJson(sanitizedDraft.document),
        seoTitle: sanitizedDraft.seoTitle,
        seoDescription: sanitizedDraft.seoDescription,
        ogImageUrl: sanitizedDraft.ogImageUrl,
        changeNote: `基于已发布版本 v${draft.versionNumber}`,
        createdById: actorId,
      },
    });
    await tx.auditLog.create({
      data: { actorId, actorType: "admin", action: "admin.site.published", targetType: "site_page", targetId: page.id, detail: { pageKey, versionNumber: published.versionNumber } },
    });
    return { published, nextDraft };
  });
}

export async function rollbackSiteBuilderDraft(pageKey: string, versionId: string, actorId: string) {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const page = runtimePages.get(pageKey);
    const source = page?.versions.find((version) => version.id === versionId && version.status !== "DRAFT");
    const draft = page?.versions.find((version) => version.status === "DRAFT");
    if (!page) throw new Error("SITE_PAGE_NOT_FOUND");
    if (!source) throw new Error("SITE_VERSION_NOT_FOUND");
    if (!draft) throw new Error("SITE_DRAFT_NOT_FOUND");
    const sanitizedSource = presentSiteVersion(source);
    Object.assign(draft, {
      document: structuredClone(sanitizedSource.document),
      seoTitle: sanitizedSource.seoTitle,
      seoDescription: sanitizedSource.seoDescription,
      ogImageUrl: sanitizedSource.ogImageUrl,
      changeNote: `从 v${source.versionNumber} 恢复到草稿`,
      createdById: actorId,
      updatedAt: new Date(),
    });
    return draft;
  }
  return prisma.$transaction(async (tx) => {
    const page = await tx.sitePage.findUnique({ where: { key: pageKey } });
    if (!page) throw new Error("SITE_PAGE_NOT_FOUND");
    const source = await tx.sitePageVersion.findFirst({
      where: { id: versionId, pageId: page.id, status: { in: ["PUBLISHED", "ARCHIVED"] } },
    });
    const draft = await tx.sitePageVersion.findFirst({
      where: { pageId: page.id, status: "DRAFT" },
      orderBy: { versionNumber: "desc" },
    });
    if (!source) throw new Error("SITE_VERSION_NOT_FOUND");
    if (!draft) throw new Error("SITE_DRAFT_NOT_FOUND");
    const sanitizedSource = presentSiteVersion({ ...source, document: parseSiteDocument(source.document) });
    const updated = await tx.sitePageVersion.update({
      where: { id: draft.id },
      data: {
        document: toJson(sanitizedSource.document),
        seoTitle: sanitizedSource.seoTitle,
        seoDescription: sanitizedSource.seoDescription,
        ogImageUrl: sanitizedSource.ogImageUrl,
        changeNote: `从 v${source.versionNumber} 恢复到草稿`,
        createdById: actorId,
      },
    });
    await tx.auditLog.create({
      data: { actorId, actorType: "admin", action: "admin.site.rollback.prepared", targetType: "site_page", targetId: page.id, detail: { pageKey, sourceVersion: source.versionNumber, draftVersion: draft.versionNumber } },
    });
    return updated;
  });
}

export async function listMediaAssets(options: { includeArchived?: boolean } = {}) {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return [...runtimeMedia.values()]
      .filter((asset) => options.includeArchived || asset.status === "ACTIVE")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(presentMediaAsset);
  }
  const assets = await prisma.mediaAsset.findMany({
    where: options.includeArchived ? undefined : { status: "ACTIVE" },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return assets.map(presentMediaAsset);
}

function presentMediaAsset<T extends { altText: string | null; name: string; url: string }>(asset: T): T {
  const retiredBrandSlug = globalThis.atob("dHJlbmRjb2Rl");
  const approvedX1Image = asset.url.startsWith("/assets/catalog/x1-air-white/vk-20260818/offers/") || asset.url.startsWith("/assets/catalog/x1-air-white/vk-20260818/gallery/");
  const unapprovedCatalogImage = asset.url.startsWith("/assets/catalog/") && !approvedX1Image;
  const retiredBrandImage = asset.url.toLowerCase().includes(retiredBrandSlug);
  if (!unapprovedCatalogImage && !retiredBrandImage) return asset;
  return {
    ...asset,
    name: `${BRAND_NAME} 待更新商品图`,
    url: "/assets/brand/product-placeholder.webp",
    altText: `${BRAND_NAME} 待更新商品图`,
  };
}

export async function getPublicSiteLastModified() {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const published = [...runtimePages.values()].flatMap((page) => page.versions).filter((version) => version.status === "PUBLISHED");
    return published.reduce<Date | null>((latest, version) => {
      const candidate = version.publishedAt ?? version.updatedAt;
      return !latest || candidate > latest ? candidate : latest;
    }, null);
  }
  const result = await prisma.sitePageVersion.aggregate({
    where: { status: "PUBLISHED" },
    _max: { publishedAt: true, updatedAt: true },
  });
  const candidates = [result._max.publishedAt, result._max.updatedAt].filter((value): value is Date => Boolean(value));
  return candidates.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

export async function createMediaAssetFromFile(file: File, input: { name?: string; altText?: string }, actorId: string) {
  await ensureSiteBuilderBootstrap();
  if (file.size <= 0 || file.size > maxMediaBytes) throw new Error("MEDIA_FILE_TOO_LARGE");
  const normalized = await normalizeUploadedImage(file, { maxBytes: maxMediaBytes });
  const existing = appConfig.COMMERCE_STORAGE === "prisma"
    ? await prisma.mediaAsset.findFirst({ where: { checksum: normalized.checksum, status: "ACTIVE" } })
    : [...runtimeMedia.values()].find((asset) => asset.checksum === normalized.checksum && asset.status === "ACTIVE");
  if (existing) return existing;
  const uploadRoot = appConfig.UPLOAD_DIR || join(process.cwd(), "public", "uploads");
  const publicRoot = normalizePublicPath(appConfig.UPLOAD_PUBLIC_PATH);
  const folder = join(uploadRoot, "content");
  const filename = `${Date.now()}-${randomUUID()}${normalized.extension}`;
  const filePath = join(folder, filename);
  await mkdir(folder, { recursive: true });
  await writeFile(filePath, normalized.buffer, { flag: "wx" });
  const url = `${publicRoot}/content/${filename}`;
  try {
    if (appConfig.COMMERCE_STORAGE !== "prisma") {
      const now = new Date();
      const asset: RuntimeMediaAsset = {
        id: `runtime-media-${randomUUID()}`,
        name: cleanOptional(input.name, 120) || file.name.slice(0, 120),
        url,
        altText: cleanOptional(input.altText, 200) ?? null,
        mimeType: normalized.mimeType,
        sizeBytes: normalized.sizeBytes,
        checksum: normalized.checksum,
        width: normalized.width,
        height: normalized.height,
        status: "ACTIVE",
        createdById: actorId,
        createdAt: now,
        updatedAt: now,
      };
      runtimeMedia.set(asset.id, asset);
      return asset;
    }
    const asset = await prisma.mediaAsset.create({
      data: {
        name: cleanOptional(input.name, 120) || file.name.slice(0, 120),
        url,
        altText: cleanOptional(input.altText, 200),
        mimeType: normalized.mimeType,
        sizeBytes: normalized.sizeBytes,
        checksum: normalized.checksum,
        width: normalized.width,
        height: normalized.height,
        createdById: actorId,
      },
    });
    await prisma.upload.create({ data: { scope: "CONTENT", ownerId: asset.id, url, mimeType: normalized.mimeType, sizeBytes: normalized.sizeBytes, checksum: normalized.checksum } });
    await writeAudit(actorId, "admin.media.created", "media_asset", asset.id, { url, name: asset.name, sourceMimeType: normalized.sourceMimeType });
    return asset;
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function registerMediaAsset(input: {
  name: string;
  url: string;
  altText?: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string;
  width?: number;
  height?: number;
}, actorId: string) {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const existing = [...runtimeMedia.values()].find((asset) => asset.url === input.url);
    if (existing) {
      Object.assign(existing, { name: input.name, altText: input.altText ?? null, width: input.width ?? existing.width, height: input.height ?? existing.height, status: "ACTIVE", updatedAt: new Date() });
      return existing;
    }
    const now = new Date();
    const asset: RuntimeMediaAsset = {
      id: `runtime-media-${randomUUID()}`,
      name: input.name,
      url: input.url,
      altText: input.altText ?? null,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      status: "ACTIVE",
      createdById: actorId,
      createdAt: now,
      updatedAt: now,
    };
    runtimeMedia.set(asset.id, asset);
    return asset;
  }
  const asset = await prisma.mediaAsset.upsert({
    where: { url: input.url },
    update: { name: input.name, altText: input.altText, mimeType: input.mimeType, sizeBytes: input.sizeBytes, checksum: input.checksum, width: input.width, height: input.height, status: "ACTIVE" },
    create: { ...input, createdById: actorId },
  });
  await writeAudit(actorId, "admin.media.registered", "media_asset", asset.id, { url: asset.url });
  return asset;
}

export async function deleteOrphanedMediaAsset(assetId: string, url: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const asset = runtimeMedia.get(assetId);
    if (asset?.url === url) runtimeMedia.delete(assetId);
    return;
  }
  await prisma.$transaction(async (tx) => {
    const inUse = await tx.productImage.count({ where: { assetId } });
    if (inUse > 0) return;
    await tx.upload.deleteMany({ where: { OR: [{ ownerId: assetId }, { url }] } });
    await tx.mediaAsset.deleteMany({ where: { id: assetId, url } });
  });
}

export async function updateMediaAsset(assetId: string, input: { name?: string; altText?: string; action?: "archive" | "restore" }, actorId: string) {
  await ensureSiteBuilderBootstrap();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const asset = runtimeMedia.get(assetId);
    if (!asset) throw new Error("MEDIA_ASSET_NOT_FOUND");
    if (input.name?.trim()) asset.name = input.name.trim().slice(0, 120);
    if (typeof input.altText === "string") asset.altText = input.altText.trim().slice(0, 200) || null;
    if (input.action) asset.status = input.action === "archive" ? "ARCHIVED" : "ACTIVE";
    asset.updatedAt = new Date();
    return asset;
  }
  const asset = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: {
      name: cleanOptional(input.name, 120),
      altText: cleanOptional(input.altText, 200),
      status: input.action === "archive" ? "ARCHIVED" : input.action === "restore" ? "ACTIVE" : undefined,
    },
  });
  await writeAudit(actorId, "admin.media.updated", "media_asset", asset.id, { action: input.action ?? "metadata", name: input.name });
  return asset;
}

export async function getMediaAssetMap(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map<string, { id: string; url: string; altText: string | null; name: string }>();
  const assets = await listMediaAssets({ includeArchived: false });
  return new Map(assets.filter((asset) => uniqueIds.includes(asset.id)).map((asset) => [asset.id, asset]));
}

export function collectMediaAssetIds(document: SiteDocument) {
  if (document.documentType !== "page") return [];
  const ids: string[] = [];
  for (const section of document.sections) {
    if ((section.type === "hero" || section.type === "productGrid") && section.mediaAssetId) ids.push(section.mediaAssetId);
    if (section.type === "categoryGrid" || section.type === "cardGrid" || section.type === "contentGrid") {
      for (const item of section.items) if (item.mediaAssetId) ids.push(item.mediaAssetId);
    }
  }
  return [...new Set(ids)];
}

async function assertDocumentReferences(document: SiteDocument) {
  const [pages, assets] = await Promise.all([
    prisma.sitePage.findMany({ select: { key: true } }),
    prisma.mediaAsset.findMany({ where: { status: "ACTIVE" }, select: { id: true } }),
  ]);
  const pageKeys = new Set(pages.map((page) => page.key));
  const assetIds = new Set(assets.map((asset) => asset.id));
  for (const link of collectLinks(document)) {
    if (!pageKeys.has(link.pageKey)) throw new Error("SITE_LINK_PAGE_NOT_FOUND");
  }
  for (const assetId of collectMediaAssetIds(document)) {
    if (!assetIds.has(assetId)) throw new Error("SITE_MEDIA_NOT_FOUND");
  }
  if (document.documentType === "page") {
    const productIds = document.sections.flatMap((section) => section.type === "productGrid" ? section.productIds : []);
    if (productIds.length) {
      const count = await prisma.product.count({
        where: {
          id: { in: [...new Set(productIds)] },
          status: "ACTIVE",
          saleMode: { in: ["PREORDER", "IN_STOCK"] },
        },
      });
      if (count !== new Set(productIds).size) throw new Error("SITE_PRODUCT_NOT_FOUND");
    }
  }
}

async function assertRuntimeDocumentReferences(document: SiteDocument) {
  const pageKeys = new Set(runtimePages.keys());
  const assetIds = new Set([...runtimeMedia.values()].filter((asset) => asset.status === "ACTIVE").map((asset) => asset.id));
  for (const link of collectLinks(document)) if (!pageKeys.has(link.pageKey)) throw new Error("SITE_LINK_PAGE_NOT_FOUND");
  for (const assetId of collectMediaAssetIds(document)) if (!assetIds.has(assetId)) throw new Error("SITE_MEDIA_NOT_FOUND");
  if (document.documentType === "page") {
    const productIds = document.sections.flatMap((section) => section.type === "productGrid" ? section.productIds : []);
    if (productIds.length) {
      const { listAdminProducts } = await import("@/lib/services/admin-catalog-service");
      const validIds = new Set((await listAdminProducts()).filter(isActiveSaleProduct).map((product) => product.id));
      if (productIds.some((id) => !validIds.has(id))) throw new Error("SITE_PRODUCT_NOT_FOUND");
    }
  }
}

function collectLinks(document: SiteDocument): PageLink[] {
  if (document.documentType === "header") return document.items;
  if (document.documentType === "footer") return [...document.columns.flatMap((column) => column.links), ...document.legalLinks];
  return document.sections.flatMap((section) => {
    if (section.type === "hero" || section.type === "productGrid") return [section.action];
    if (section.type === "categoryGrid") return section.items.map((item) => item.link);
    return [...(section.action?[section.action]:[]),...section.items.flatMap((item) => item.link ? [item.link] : [])];
  });
}

function assertDocumentMatchesPage(kind: string, document: SiteDocument) {
  if (kind === "HEADER" && document.documentType !== "header") throw new Error("SITE_DOCUMENT_TYPE_MISMATCH");
  if (kind === "FOOTER" && document.documentType !== "footer") throw new Error("SITE_DOCUMENT_TYPE_MISMATCH");
  if ((kind === "HOME" || kind === "CONTENT") && document.documentType !== "page") throw new Error("SITE_DOCUMENT_TYPE_MISMATCH");
}

function getRuntimeDefaultPage(pageKey: string) {
  const definition = sitePageDefinitions.find((page) => page.key === pageKey);
  if (!definition) return null;
  const document = buildDefaultSiteDocument(pageKey);
  return {
    page: { id: `runtime-${pageKey}`, key: pageKey, name: definition.name, path: definition.path, kind: definition.kind, template: definition.template, sortOrder: definition.sortOrder },
    version: { id: `runtime-${pageKey}-v1`, versionNumber: 1, status: "PUBLISHED", document, seoTitle: definition.seoTitle ?? definition.name, seoDescription: definition.seoDescription ?? "", ogImageUrl: builtInShareImageUrl },
  };
}

export function getResolvedNavigation(document: SiteDocument, pages: Array<{ key: string; path: string | null }>) {
  if (document.documentType === "header") return document.items.map((link) => ({ label: link.label, href: resolvePageHref(link, pages) }));
  return [];
}


function cleanOptional(value: string | undefined, max: number) {
  const clean = value?.trim().slice(0, max);
  return clean || undefined;
}

function cleanBrandedOptional(value: string | undefined, max: number) {
  const clean = cleanOptional(value, max);
  return clean ? applyCurrentBrandName(clean) : undefined;
}

function normalizePublicPath(value: string) {
  const trimmed = value.trim() || "/uploads";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function writeAudit(actorId: string, action: string, targetType: string, targetId: string, detail: unknown) {
  await prisma.auditLog.create({ data: { actorId, actorType: "admin", action, targetType, targetId, detail: toJson(detail) } });
}
