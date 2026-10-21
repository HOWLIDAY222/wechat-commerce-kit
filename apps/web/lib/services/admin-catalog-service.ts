import { assertQuantityPricingFitsSkus, parseQuantityPricing, type QuantityPricing } from "@/lib/commerce/quantity-pricing";
import { createHash } from "node:crypto";
import { inventoryAfter } from "@/lib/commerce/admin-operations";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { catalogProducts } from "@/lib/catalog";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { writeRuntimeAdminAudit } from "@/lib/services/admin-ops-service";

type ProductInput = {
  initialSku?: SkuInput;
  requestId?: string;
  quantityPricing?: QuantityPricing;
  slug: string;
  code: string;
  name: string;
  category: string;
  scene?: string;
  summary: string;
  description?: string;
  image?: string;
  silhouette?: string;
  rise?: string;
  coverage?: string;
  supportLevel?: string;
  fabricComposition?: string;
  features?: string[];
  fitNote?: string;
  careInstructions?: string;
  packSize?: number | null;
  status?: "ACTIVE" | "HIDDEN";
  saleMode?: "SHOWCASE" | "PREORDER" | "IN_STOCK" | "PAUSED";
  saleStartsAt?: Date | string | null;
  estimatedShipAt?: Date | string | null;
  countdownEnabled?: boolean;
  showPrice?: boolean;
  sortOrder?: number;
};

type ProductPatch = Partial<Omit<ProductInput, "slug" | "code" | "initialSku" | "requestId">>;

type SkuInput = {
  skuCode: string;
  color: string;
  size: string;
  priceCents: number;
  stockQuantity: number;
  reservedQuantity?: number;
  status?: "ACTIVE" | "HIDDEN";
};

type SkuPatch = Partial<Omit<SkuInput, "skuCode">>;

type ProductImageInput = {
  assetId?: string;
  imageUrl: string;
  alt?: string;
  sortOrder?: number;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
};

type ProductImagePatch = {
  alt?: string;
  sortOrder?: number;
  makePrimary?: boolean;
};

type InventoryAdjustment = {
  action: "ADJUST" | "RESTOCK" | "DAMAGE";
  requestId: string;
  expectedStock: number;
  quantity: number;
  note?: string;
  actorId: string;
};

type RuntimeAdminProduct = ProductInput & {
  id: string;
  status: "ACTIVE" | "HIDDEN";
  sortOrder: number;
  skus: Array<RuntimeAdminSku>;
  images: Array<{ id: string; imageUrl: string; alt?: string; sortOrder: number }>;
  createdAt: Date;
  updatedAt: Date;
};

type RuntimeAdminSku = SkuInput & {
  id: string;
  status: "ACTIVE" | "HIDDEN";
  reservedQuantity: number;
  inventoryLogs: Array<{
    id: string;
    action: "ADJUST" | "RESTOCK" | "DEDUCT";
    operation?: string;
    beforeQuantity?: number;
    afterQuantity?: number;
    reservedSnapshot?: number;
    quantity: number;
    note?: string;
    actorId: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

const globalForAdminCatalog = globalThis as typeof globalThis & {
  __merchantkitRuntimeProducts?: Map<string, RuntimeAdminProduct>;
  __merchantkitRuntimeSkuIndex?: Map<string, { productId: string; skuId: string }>;
};

const runtimeProducts = globalForAdminCatalog.__merchantkitRuntimeProducts ?? new Map<string, RuntimeAdminProduct>();
const runtimeSkuIndex = globalForAdminCatalog.__merchantkitRuntimeSkuIndex ?? new Map<string, { productId: string; skuId: string }>();
globalForAdminCatalog.__merchantkitRuntimeProducts = runtimeProducts;
globalForAdminCatalog.__merchantkitRuntimeSkuIndex = runtimeSkuIndex;

function ensureRuntimeProducts() {
  if (runtimeProducts.size > 0) return;
  for (const [index, product] of catalogProducts.entries()) {
    const isX1AirWhitePreorder = product.slug === "x1-air-white";
    const id = `runtime-product-${product.slug}`;
    const now = new Date();
    const skus = product.colors.flatMap((color) => {
      return product.sizes.map((size) => {
        const sku: RuntimeAdminSku = {
          id: `runtime-sku-${product.code}-${color}-${size}`.replace(/\s+/g, "-").toUpperCase(),
          skuCode: `${product.code}-${color}-${size}`.replace(/\s+/g, "-").toUpperCase(),
          color,
          size,
          priceCents: product.priceCents,
          stockQuantity: isX1AirWhitePreorder ? 50 : 0,
          reservedQuantity: 0,
          status: "ACTIVE",
          inventoryLogs: [],
          createdAt: now,
          updatedAt: now,
        };
        runtimeSkuIndex.set(sku.id, { productId: id, skuId: sku.id });
        return sku;
      });
    });
    runtimeProducts.set(id, {
      id,
      slug: product.slug,
      code: product.code,
      name: product.name,
      category: product.category,
      scene: product.scene,
      summary: product.summary,
      description: product.description,
      image: product.image,
      silhouette: product.silhouette,
      rise: product.rise,
      coverage: product.coverage,
      supportLevel: product.supportLevel,
      fabricComposition: product.fabricComposition,
      features: product.features,
      fitNote: product.fitNote,
      careInstructions: product.careInstructions,
      packSize: product.packSize,
      status: isX1AirWhitePreorder ? "ACTIVE" : "HIDDEN",
      saleMode: isX1AirWhitePreorder ? "PREORDER" : "SHOWCASE",
      saleStartsAt: isX1AirWhitePreorder ? "2026-08-02T00:00:00+08:00" : null,
      estimatedShipAt: isX1AirWhitePreorder ? "2026-10-02T23:59:59+08:00" : null,
      countdownEnabled: false,
      showPrice: isX1AirWhitePreorder,
      sortOrder: index,
      skus,
      images: product.images.map((imageUrl, imageIndex) => ({
        id: `runtime-image-${product.slug}-${imageIndex}`,
        imageUrl,
        alt: imageIndex === 0 ? `${product.name} 商品陈列图` : `${product.name} 上身展示图`,
        sortOrder: imageIndex * 10,
      })),
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function listAdminProducts() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    ensureRuntimeProducts();
    return Array.from(runtimeProducts.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return prisma.product.findMany({
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      skus: {
        include: { inventoryLogs: { orderBy: { createdAt: "desc" }, take: 20 } },
        orderBy: [{ color: "asc" }, { size: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function createAdminProduct(input: ProductInput, actorId: string) {
  const {initialSku,requestId,...fields}=input;
  const requestProductId=requestId ? "draft-"+createHash("sha256").update(actorId+":"+requestId).digest("hex") : undefined;
  if(requestProductId && runtimeProducts.has(requestProductId))return runtimeProducts.get(requestProductId)!;
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    ensureRuntimeProducts();
    if (Array.from(runtimeProducts.values()).some((product) => product.slug === input.slug || product.code === input.code)) {
      throw new Error("PRODUCT_ALREADY_EXISTS");
    }
    const now = new Date();
    const product: RuntimeAdminProduct = {
      ...fields,
      id: requestProductId ?? `runtime-product-${randomUUID()}`,
      status: input.status ?? "ACTIVE",
      saleMode: input.saleMode ?? "SHOWCASE",
      saleStartsAt: input.saleStartsAt ?? null,
      estimatedShipAt: input.estimatedShipAt ?? null,
      countdownEnabled: input.countdownEnabled ?? false,
      showPrice: input.showPrice ?? false,
      features: input.features ?? [],
      sortOrder: input.sortOrder ?? runtimeProducts.size,
      skus: [],
      images: input.image ? [{ id: `runtime-image-${randomUUID()}`, imageUrl: input.image, alt: input.name, sortOrder: 0 }] : [],
      createdAt: now,
      updatedAt: now,
    };
    runtimeProducts.set(product.id, product);
    if(initialSku) await createAdminSku(product.id,initialSku,actorId);
    writeRuntimeAdminAudit(actorId, "admin.product.created", "product", product.id, { slug: product.slug });
    return product;
  }

  return prisma.$transaction(async tx=>{
    const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if(requestProductId){
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestProductId}))`;
      const existing=await tx.product.findUnique({where:{id:requestProductId},include:{images:true,skus:true}});
      if(existing){const audit=await tx.auditLog.findFirst({where:{targetId:existing.id,action:'admin.product.created'}});if((audit?.detail as {fingerprint?:string})?.fingerprint!==fingerprint)throw Error('IDEMPOTENCY_CONFLICT');return existing;}
    }
  const product = await tx.product.create({
    data: {
      ...fields,
      id: requestProductId,
      skus: initialSku ? {create:{...initialSku,inventoryLogs:{create:{action:"ADJUST",operation:"CREATE",quantity:initialSku.stockQuantity,beforeQuantity:0,afterQuantity:initialSku.stockQuantity,reservedSnapshot:0,actorId}}}} : undefined,
      status: input.status ?? "ACTIVE",
      saleMode: input.saleMode ?? "SHOWCASE",
      saleStartsAt: toNullableDate(input.saleStartsAt),
      estimatedShipAt: toNullableDate(input.estimatedShipAt),
      countdownEnabled: input.countdownEnabled ?? false,
      showPrice: input.showPrice ?? false,
      sortOrder: input.sortOrder ?? 0,
      images: input.image
        ? { create: [{ imageUrl: input.image, alt: input.name, sortOrder: 0 }] }
        : undefined,
    },
    include: { images: true, skus: true },
  });
  await tx.auditLog.create({data:{actorId,actorType:'admin',action:'admin.product.created',targetType:'product',targetId:product.id,detail:{slug:product.slug,fingerprint}}});
  return product;
  });
}

export async function updateAdminProduct(productId: string, input: ProductPatch, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    ensureRuntimeProducts();
    const product = runtimeProducts.get(productId) ?? Array.from(runtimeProducts.values()).find((item) => item.slug === productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");
    const nextProduct = { ...product, ...input };
    if (nextProduct.status === "ACTIVE") assertProductReadyForSale(nextProduct);
    Object.assign(product, input, { updatedAt: new Date() });
    writeRuntimeAdminAudit(actorId, "admin.product.updated", "product", product.id, input);
    return product;
  }

  const current = await prisma.product.findUnique({
    where: { id: productId },
    include: { images: true, skus: { where: { status: "ACTIVE" } } },
  });
  if (!current) throw new Error("PRODUCT_NOT_FOUND");
  const nextProduct = { ...current, ...input };
  if (nextProduct.status === "ACTIVE") assertProductReadyForSale(nextProduct);

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      ...input,
      saleStartsAt: toNullableDate(input.saleStartsAt),
      estimatedShipAt: toNullableDate(input.estimatedShipAt),
    },
    include: { images: true, skus: true },
  });
  await writeAdminAudit(actorId, "admin.product.updated", "product", product.id, input);
  return product;
}

export function assertProductReadyForSale(product: {
  careInstructions?: string | null;
  countdownEnabled?: boolean | null;
  description?: string | null;
  fabricComposition?: string | null;
  image?: string | null;
  images: Array<unknown>;
  saleMode?: string | null;
  saleStartsAt?: Date | string | null;
  silhouette?: string | null;
  skus: Array<{ priceCents: number; stockQuantity?: number; reservedQuantity?: number; status?: string }>;
  summary?: string | null;
  rise?: string | null;
}) {
  if (!product.image && product.images.length === 0) throw new Error("PRODUCT_IMAGE_REQUIRED_BEFORE_PUBLISH");
  const activeSkus = product.skus.filter((sku) => !sku.status || sku.status === "ACTIVE");
  if (!activeSkus.some((sku) => sku.priceCents > 0)) throw new Error("ACTIVE_SKU_PRICE_REQUIRED_BEFORE_PUBLISH");
  if (!isConsumerReadyText(product.summary, 12)) throw new Error("PRODUCT_SUMMARY_REQUIRED_BEFORE_PUBLISH");
  if (!isConsumerReadyText(product.description, 24)) throw new Error("PRODUCT_DESCRIPTION_REQUIRED_BEFORE_PUBLISH");
  if (product.saleMode === "PREORDER" || product.saleMode === "IN_STOCK") {
    if (!isConsumerReadyText(product.silhouette, 1)) throw new Error("PRODUCT_SILHOUETTE_REQUIRED_BEFORE_SALE");
    if (!isConsumerReadyText(product.rise, 1)) throw new Error("PRODUCT_RISE_REQUIRED_BEFORE_SALE");
    if (!isConsumerReadyText(product.fabricComposition, 4)) throw new Error("PRODUCT_FABRIC_REQUIRED_BEFORE_SALE");
    if (!isConsumerReadyText(product.careInstructions, 4)) throw new Error("PRODUCT_CARE_REQUIRED_BEFORE_SALE");
    const hasAvailableInventory = activeSkus.some((sku) => (sku.stockQuantity ?? 0) - (sku.reservedQuantity ?? 0) > 0);
    if (!hasAvailableInventory) throw new Error("AVAILABLE_STOCK_REQUIRED_BEFORE_SALE");
  }
  if (product.countdownEnabled) {
    const startsAt = product.saleStartsAt ? new Date(product.saleStartsAt) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      throw new Error("FUTURE_SALE_TIME_REQUIRED_FOR_COUNTDOWN");
    }
  }
}

function isConsumerReadyText(value: string | null | undefined, minimumLength: number) {
  const normalized = value?.trim() ?? "";
  if (normalized.length < minimumLength) return false;
  return !/^(?:无|暂无|待定|test|demo|x-series\s*\d*)$/i.test(normalized);
}

function toNullableDate(value: Date | string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_PRODUCT_RELEASE_DATE");
  return date;
}

export async function addAdminProductImage(productId: string, input: ProductImageInput, actorId: string) {
  const sortOrder = input.sortOrder ?? 0;
  if (!input.imageUrl) throw new Error("INVALID_PRODUCT_IMAGE_REQUEST");

  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    ensureRuntimeProducts();
    const product = runtimeProducts.get(productId) ?? Array.from(runtimeProducts.values()).find((item) => item.slug === productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");
    const image = {
      id: `runtime-image-${randomUUID()}`,
      imageUrl: input.imageUrl,
      alt: input.alt,
      sortOrder,
    };
    product.images.push(image);
    product.images.sort((a, b) => a.sortOrder - b.sortOrder);
    if (!product.image || sortOrder === 0) product.image = input.imageUrl;
    product.updatedAt = new Date();
    writeRuntimeAdminAudit(actorId, "admin.product.image.added", "product", product.id, { imageUrl: input.imageUrl, sortOrder, alt: input.alt ?? null });
    return image;
  }

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      select: { id: true, image: true },
      where: { id: productId },
    });
    if (!product) throw new Error("PRODUCT_NOT_FOUND");

    const image = await tx.productImage.create({
      data: {
        productId: product.id,
        assetId: input.assetId,
        imageUrl: input.imageUrl,
        alt: input.alt,
        sortOrder,
      },
    });

    if (input.mimeType && typeof input.sizeBytes === "number") {
      await tx.upload.create({
        data: {
          scope: "PRODUCT",
          ownerId: product.id,
          url: input.imageUrl,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          checksum: input.checksum,
        },
      });
    }

    if (!product.image || sortOrder === 0) {
      await tx.product.update({
        data: { image: input.imageUrl },
        where: { id: product.id },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: "admin.product.image.added",
        targetType: "product",
        targetId: product.id,
        detail: JSON.parse(JSON.stringify({ imageUrl: input.imageUrl, sortOrder, alt: input.alt ?? null })) as Prisma.InputJsonValue,
      },
    });

    return image;
  });

  return result;
}

export async function updateAdminProductImage(productId: string, imageId: string, input: ProductImagePatch, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    ensureRuntimeProducts();
    const product = runtimeProducts.get(productId) ?? Array.from(runtimeProducts.values()).find((item) => item.slug === productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");
    const image = product.images.find((item) => item.id === imageId);
    if (!image) throw new Error("PRODUCT_IMAGE_NOT_FOUND");
    if (typeof input.alt === "string") image.alt = input.alt || undefined;
    if (typeof input.sortOrder === "number") image.sortOrder = input.sortOrder;
    if (input.makePrimary) {
      product.images
        .filter((item) => item.id !== image.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .forEach((item, index) => { item.sortOrder = (index + 1) * 10; });
      image.sortOrder = 0;
      product.image = image.imageUrl;
    }
    product.images.sort((a, b) => a.sortOrder - b.sortOrder);
    product.updatedAt = new Date();
    writeRuntimeAdminAudit(actorId, input.makePrimary ? "admin.product.image.primary_set" : "admin.product.image.updated", "product_image", image.id, { productId: product.id, alt: input.alt ?? null, sortOrder: input.sortOrder ?? null });
    return image;
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!existing) throw new Error("PRODUCT_IMAGE_NOT_FOUND");

    let image = await tx.productImage.update({
      data: {
        alt: input.alt,
        sortOrder: input.sortOrder,
      },
      where: { id: imageId },
    });

    if (input.makePrimary) {
      const remainingImages = await tx.productImage.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        where: { productId, id: { not: image.id } },
      });
      for (const [index, item] of remainingImages.entries()) {
        await tx.productImage.update({
          data: { sortOrder: (index + 1) * 10 },
          where: { id: item.id },
        });
      }
      image = await tx.productImage.update({
        data: { sortOrder: 0 },
        where: { id: image.id },
      });
      await tx.product.update({
        data: { image: image.imageUrl },
        where: { id: productId },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: input.makePrimary ? "admin.product.image.primary_set" : "admin.product.image.updated",
        targetType: "product_image",
        targetId: image.id,
        detail: JSON.parse(JSON.stringify({ productId, alt: input.alt ?? null, sortOrder: input.sortOrder ?? null })) as Prisma.InputJsonValue,
      },
    });

    return image;
  });
}

export async function deleteAdminProductImage(productId: string, imageId: string, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    ensureRuntimeProducts();
    const product = runtimeProducts.get(productId) ?? Array.from(runtimeProducts.values()).find((item) => item.slug === productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");
    const imageIndex = product.images.findIndex((item) => item.id === imageId);
    if (imageIndex < 0) throw new Error("PRODUCT_IMAGE_NOT_FOUND");
    const [image] = product.images.splice(imageIndex, 1);
    if (product.image === image.imageUrl) product.image = product.images[0]?.imageUrl;
    product.updatedAt = new Date();
    writeRuntimeAdminAudit(actorId, "admin.product.image.deleted", "product_image", image.id, { productId: product.id, imageUrl: image.imageUrl });
    return image;
  }

  return prisma.$transaction(async (tx) => {
    const image = await tx.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) throw new Error("PRODUCT_IMAGE_NOT_FOUND");

    await tx.productImage.delete({ where: { id: image.id } });

    const product = await tx.product.findUnique({
      select: { image: true },
      where: { id: productId },
    });
    if (product?.image === image.imageUrl) {
      const nextImage = await tx.productImage.findFirst({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        where: { productId },
      });
      await tx.product.update({
        data: { image: nextImage?.imageUrl ?? null },
        where: { id: productId },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: "admin.product.image.deleted",
        targetType: "product_image",
        targetId: image.id,
        detail: JSON.parse(JSON.stringify({ productId, imageUrl: image.imageUrl })) as Prisma.InputJsonValue,
      },
    });

    return image;
  });
}

export async function createAdminSku(productId: string, input: SkuInput, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    ensureRuntimeProducts();
    const product = runtimeProducts.get(productId) ?? Array.from(runtimeProducts.values()).find((item) => item.slug === productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");
    if (runtimeSkuIndex.has(input.skuCode) || product.skus.some((sku) => sku.skuCode === input.skuCode)) {
      throw new Error("SKU_ALREADY_EXISTS");
    }
    assertQuantityPricingFitsSkus(product.quantityPricing,[...product.skus,{...input,status:input.status??"ACTIVE"}]);
    const now = new Date();
    const sku: RuntimeAdminSku = {
      ...input,
      id: `runtime-sku-${randomUUID()}`,
      status: input.status ?? "ACTIVE",
      reservedQuantity: input.reservedQuantity ?? 0,
      inventoryLogs: [{id:`runtime-inventory-${randomUUID()}`,action:"ADJUST",operation:"CREATE",quantity:input.stockQuantity,beforeQuantity:0,afterQuantity:input.stockQuantity,reservedSnapshot:input.reservedQuantity??0,actorId,createdAt:now}],
      createdAt: now,
      updatedAt: now,
    };
    product.skus.push(sku);
    product.updatedAt = now;
    runtimeSkuIndex.set(sku.id, { productId: product.id, skuId: sku.id });
    writeRuntimeAdminAudit(actorId, "admin.sku.created", "product_sku", sku.id, { productId: product.id, skuCode: sku.skuCode });
    return sku;
  }

  return prisma.$transaction(async tx => {
  const product = await tx.product.update({where:{id:productId},data:{updatedAt:new Date()},include:{skus:true}});
  assertQuantityPricingFitsSkus(product.quantityPricing,[...product.skus,{...input,status:input.status??"ACTIVE"}]);
  const sku = await tx.productSku.create({
    data: {
      productId,
      ...input,
      inventoryLogs:{create:{action:"ADJUST",operation:"CREATE",quantity:input.stockQuantity,beforeQuantity:0,afterQuantity:input.stockQuantity,reservedSnapshot:input.reservedQuantity??0,actorId}},
      reservedQuantity: input.reservedQuantity ?? 0,
      status: input.status ?? "ACTIVE",
    },
  });
  await tx.auditLog.create({data:{actorId,actorType:"admin",action:"admin.sku.created",targetType:"product_sku",targetId:sku.id,detail:{productId,skuCode:sku.skuCode}}});
  return sku;
  });
}

export async function updateAdminSku(skuId: string, input: SkuPatch, actorId: string) {
 if(input.stockQuantity!==undefined||input.reservedQuantity!==undefined)throw Error('USE_INVENTORY_ACTION');
 if(appConfig.COMMERCE_STORAGE!=='prisma') {
   ensureRuntimeProducts();const sku=findRuntimeSku(skuId),product=Array.from(runtimeProducts.values()).find(p=>p.skus.includes(sku))!;
   assertQuantityPricingFitsSkus(product.quantityPricing,product.skus.map(s=>s.id===skuId?{...s,...input}:s));
   Object.assign(sku,input,{updatedAt:new Date()});writeRuntimeAdminAudit(actorId,'admin.sku.updated','product_sku',sku.id,input);return sku;
 }
 return prisma.$transaction(async tx=>{
   const current=await tx.productSku.findUniqueOrThrow({where:{id:skuId}});
   const product=await tx.product.update({where:{id:current.productId},data:{updatedAt:new Date()},include:{skus:true}});
   assertQuantityPricingFitsSkus(product.quantityPricing,product.skus.map(s=>s.id===skuId?{...s,...input}:s));
   const sku=await tx.productSku.update({where:{id:skuId},data:input});
   await tx.auditLog.create({data:{actorId,actorType:'admin',action:'admin.sku.updated',targetType:'product_sku',targetId:sku.id,detail:{before:{priceCents:current.priceCents,status:current.status},after:input}}});return sku;
 });
}

export async function updateAdminProductPricing(productId:string,input:{unitPriceCents?:number;quantityPricing:QuantityPricing|null},actorId:string){
 const pricing=parseQuantityPricing(input.quantityPricing);
 if(input.unitPriceCents!==undefined&&(!Number.isSafeInteger(input.unitPriceCents)||input.unitPriceCents<=0))throw Error('INVALID_PRICE');
 if(appConfig.COMMERCE_STORAGE!=='prisma'){
   ensureRuntimeProducts();const product=runtimeProducts.get(productId);if(!product)throw Error('PRODUCT_NOT_FOUND');
   const skus=product.skus.map(s=>s.status==='ACTIVE'&&input.unitPriceCents!==undefined?{...s,priceCents:input.unitPriceCents}:s);
   assertQuantityPricingFitsSkus(pricing,skus);product.skus.forEach(s=>{if(s.status==='ACTIVE'&&input.unitPriceCents!==undefined)s.priceCents=input.unitPriceCents;});product.quantityPricing=pricing??undefined;
   writeRuntimeAdminAudit(actorId,'admin.product.pricing','product',productId,input);return product;
 }
 return prisma.$transaction(async tx=>{
   const product=await tx.product.update({where:{id:productId},data:{updatedAt:new Date()},include:{skus:true}});
   const skus=product.skus.map(s=>s.status==='ACTIVE'&&input.unitPriceCents!==undefined?{...s,priceCents:input.unitPriceCents}:s);
   assertQuantityPricingFitsSkus(pricing,skus);
   const usedStyles=await tx.cartItem.findMany({where:{sku:{productId},style:{not:''}},select:{style:true},distinct:['style']});
   if(usedStyles.some(line=>!pricing?.styles?.some(style=>style.key===line.style)))throw Error('PRODUCT_STYLE_IN_USE');
   if(input.unitPriceCents!==undefined)await tx.productSku.updateMany({where:{productId,status:'ACTIVE'},data:{priceCents:input.unitPriceCents}});
   const {Prisma}=await import('@prisma/client');
   const updated=await tx.product.update({where:{id:productId},data:{quantityPricing:pricing??Prisma.DbNull},include:{skus:true}});
   await tx.auditLog.create({data:{actorId,actorType:'admin',action:'admin.product.pricing',targetType:'product',targetId:productId,detail:JSON.parse(JSON.stringify({before:{quantityPricing:product.quantityPricing,prices:product.skus.map(s=>({id:s.id,priceCents:s.priceCents}))},after:input}))}});return updated;
 });
}

export async function adjustAdminInventory(skuId: string, input: InventoryAdjustment) {
  if (!input.requestId || !Number.isSafeInteger(input.expectedStock)) throw Error('INVENTORY_REQUEST_ID_REQUIRED');
  const id='inv-'+createHash('sha256').update(input.actorId+':'+skuId+':'+input.requestId).digest('hex');
  const action=input.action==='DAMAGE'?'DEDUCT' as const:input.action;
  const replay = (log: {action:string;quantity:number;note?:string|null;operation?:string|null}) => {
    if(log.action!==action||log.quantity!==input.quantity||(log.note??'')!==(input.note??'')||log.operation!==input.action) throw Error('IDEMPOTENCY_CONFLICT');
  };
  if (appConfig.COMMERCE_STORAGE !== 'prisma') {
    ensureRuntimeProducts(); const sku=findRuntimeSku(skuId), previous=sku.inventoryLogs.find(log=>log.id===id);
    if(previous){replay(previous);return {sku,inventoryLog:previous};}
    if(sku.stockQuantity!==input.expectedStock)throw Error('INVENTORY_CHANGED');
    const beforeQuantity=sku.stockQuantity, afterQuantity=inventoryAfter(beforeQuantity,sku.reservedQuantity,input.action,input.quantity);
    const log={id,action,operation:input.action,quantity:input.quantity,note:input.note,actorId:input.actorId,createdAt:new Date(),beforeQuantity,afterQuantity,reservedSnapshot:sku.reservedQuantity};
    sku.stockQuantity=afterQuantity;sku.updatedAt=new Date();sku.inventoryLogs.unshift(log);
    writeRuntimeAdminAudit(input.actorId,'admin.inventory.adjusted','product_sku',sku.id,log);
    return {sku,inventoryLog:log};
  }
  try { return await prisma.$transaction(async tx=>{
    const previous=await tx.inventoryLog.findUnique({where:{id}});
    if(previous){replay(previous);return {sku:await tx.productSku.findUniqueOrThrow({where:{id:skuId}}),inventoryLog:previous};}
    const before=await tx.productSku.findUniqueOrThrow({where:{id:skuId}});
    if(before.stockQuantity!==input.expectedStock)throw Error('INVENTORY_CHANGED');
    const afterQuantity=inventoryAfter(before.stockQuantity,before.reservedQuantity,input.action,input.quantity);
    const changed=await tx.productSku.updateMany({where:{id:skuId,stockQuantity:before.stockQuantity,reservedQuantity:before.reservedQuantity},data:{stockQuantity:afterQuantity}});
    if(changed.count!==1)throw Error('INVENTORY_CHANGED');
    const inventoryLog=await tx.inventoryLog.create({data:{id,skuId,action,operation:input.action,quantity:input.quantity,note:input.note,actorId:input.actorId,beforeQuantity:before.stockQuantity,afterQuantity,reservedSnapshot:before.reservedQuantity}});
    await tx.auditLog.create({data:{actorId:input.actorId,actorType:'admin',action:'admin.inventory.adjusted',targetType:'product_sku',targetId:skuId,detail:{...input,beforeQuantity:before.stockQuantity,afterQuantity,reservedSnapshot:before.reservedQuantity}}});
    return {sku:await tx.productSku.findUniqueOrThrow({where:{id:skuId}}),inventoryLog};
  }); } catch(error) {
    const previous=await prisma.inventoryLog.findUnique({where:{id}});
    if(previous){replay(previous);return {sku:await prisma.productSku.findUniqueOrThrow({where:{id:skuId}}),inventoryLog:previous};}
    throw error;
  }
}

function findRuntimeSku(skuId: string) {
  const skuRef = runtimeSkuIndex.get(skuId);
  if (skuRef) {
    const sku = runtimeProducts.get(skuRef.productId)?.skus.find((item) => item.id === skuRef.skuId);
    if (sku) return sku;
  }

  for (const product of runtimeProducts.values()) {
    const sku = product.skus.find((item) => item.id === skuId || item.skuCode === skuId);
    if (sku) return sku;
  }
  throw new Error("SKU_NOT_FOUND");
}

async function writeAdminAudit(actorId: string, action: string, targetType: string, targetId: string, detail: unknown) {
  const jsonDetail = JSON.parse(JSON.stringify(detail ?? {})) as Prisma.InputJsonValue;
  await prisma.auditLog.create({
    data: {
      actorId,
      actorType: "admin",
      action,
      targetType,
      targetId,
      detail: jsonDetail,
    },
  });
}
