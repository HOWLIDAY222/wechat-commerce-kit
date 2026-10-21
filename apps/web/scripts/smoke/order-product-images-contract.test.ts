import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { withOrderItemProductImage } from "../../lib/commerce/order-product-images";

const product = { slug: "x1-air-white", image: "/catalog/x1-main.jpg", images: [{ imageUrl: "/catalog/x1-gallery.jpg" }] };
const historicalItem = {
  id: "historical-item", productId: "product-1", skuId: "sku-1", productCode: "DEMO-ESSENTIAL-BRIEF",
  productName: "Purchased product name", style: "regular", color: "白色", size: "M", quantity: 1,
  unitPriceCents: 4400, discountShareCents: 100, refundAmountCents: 4300,
  createdAt: new Date("2026-10-18T00:00:00Z"), product,
};
const fixture = {
  id: "order-1", orderNo: "ORDER-1", userId: "owner-1", status: "CLOSED", paymentStatus: "REFUNDED",
  fulfillmentStatus: "PENDING", currency: "CNY", subtotalCents: 4400, discountCents: 100,
  payableAmountCents: 4300, shippingFeeCents: 0, items: [historicalItem],
  refunds: [{ id: "refund-1", refundAmountCents: 4300, refundStatus: "SUCCEEDED" }],
  afterSalesRequests: [{ id: "request-1", status: "CANCELLED" }], shipments: [],
};

test("historical items gain only an image field and keep purchased snapshots and financial values", () => {
  const original = structuredClone(historicalItem);
  const result = withOrderItemProductImage(historicalItem);
  const { product: unusedProduct, ...snapshot } = historicalItem;
  assert.deepEqual(result, { ...snapshot, productImage: "/assets/catalog/x1-air-white/vk-20261014-packs/pack-1-750.webp" });
  assert.deepEqual(historicalItem, original);
  assert.equal("product" in result, false);
  assert.ok(unusedProduct);
});

test("the exact X1 product uses the existing legal size, color and pack quantity rules", () => {
  for (const size of ["S", "M", "L"]) for (const quantity of [1, 2, 3, 4]) {
    assert.equal(withOrderItemProductImage({ ...historicalItem, size, quantity }).productImage,
      `/assets/catalog/x1-air-white/vk-20261014-packs/pack-${quantity}-750.webp`);
  }
  for (const patch of [{ color: "黑色" }, { size: "XL" }, { quantity: 5 }, { quantity: 1.5 }]) {
    assert.equal(withOrderItemProductImage({ ...historicalItem, ...patch }).productImage, product.image);
  }
});

test("another product with the same color and quantity always uses its own catalog image", () => {
  const result = withOrderItemProductImage({ ...historicalItem, product: { ...product, slug: "another-product", image: "/catalog/other.jpg" } });
  assert.equal(result.productImage, "/catalog/other.jpg");
  assert.equal("product" in result, false);
});

test("existing item image fields take priority over the current catalog image", () => {
  assert.equal(withOrderItemProductImage({ ...historicalItem, productImage: " /snapshot/purchased.jpg ", image: "/snapshot/legacy.jpg" }).productImage, "/snapshot/purchased.jpg");
  assert.equal(withOrderItemProductImage({ ...historicalItem, productImage: " ", image: "/snapshot/legacy.jpg" }).productImage, "/snapshot/legacy.jpg");
});

test("a generic product falls back to its first ordered gallery image and missing images stay empty", () => {
  assert.equal(withOrderItemProductImage({ ...historicalItem, product: { ...product, slug: "another-product", image: " " } }).productImage, "/catalog/x1-gallery.jpg");
  assert.equal(withOrderItemProductImage({ ...historicalItem, product: { ...product, slug: "another-product", image: null, images: [] } }).productImage, "");
  assert.equal(withOrderItemProductImage({ ...historicalItem, product: null }).productImage, "");
  const { product: unusedProduct, ...withoutRelation } = historicalItem;
  assert.equal(withOrderItemProductImage(withoutRelation).productImage, "");
  assert.ok(unusedProduct);
});

type ReadMethods = {
  listOrdersByUser(userId: string): Promise<Array<Record<string, unknown>>>;
  getOrderForUser(orderNo: string, userId: string): Promise<Record<string, unknown> | null>;
};

function actualOrderReads(options: { storage?: string; missing?: boolean } = {}) {
  const file = join(process.cwd(), "lib/services/order-service.ts");
  const source = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = parsed.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement)) return ["listOrdersByUser", "getOrderForUser"].includes(statement.name?.text ?? "");
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
      ts.isIdentifier(declaration.name) && ["orderInclude", "orderReadInclude"].includes(declaration.name.text));
  }).map(statement => statement.getText(parsed));
  assert.equal(declarations.length, 4, "Use the actual two read functions and their actual query includes");
  const queries: Array<{ method: string; query: unknown }> = [], summaryIds: string[] = [];
  const response = structuredClone(fixture), runtimeResponse = { id: "runtime-order", items: [] };
  const context = {
    exports: {}, appConfig: { COMMERCE_STORAGE: options.storage ?? "prisma" }, withOrderItemProductImage,
    // Pickup enrichment has its own database regression suite. Keep these
    // isolated image-read tests focused on historical item snapshots.
    attachOrderPickups: async (orders: unknown[]) => orders,
    prisma: { order: {
      findMany: async (query: unknown) => { queries.push({ method: "findMany", query }); return [response]; },
      findFirst: async (query: unknown) => { queries.push({ method: "findFirst", query }); return options.missing ? null : response; },
    } },
    getOrderRefundSummary: async (id: string) => { summaryIds.push(id); return { fullyRefunded: true, succeededAmountCents: 4300 }; },
    listRuntimeOrdersByUser: (userId: string) => { assert.equal(userId, "owner-1"); return [runtimeResponse]; },
    getRuntimeOrderForUser: (orderNo: string, userId: string) => { assert.equal(orderNo, "ORDER-1"); assert.equal(userId, "owner-1"); return runtimeResponse; },
  };
  const output = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(output, context, { timeout: 1000 });
  return { methods: context.exports as ReadMethods, queries, summaryIds, response, runtimeResponse, source };
}

function plain<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

test("actual user order list adds productImage through one scoped read without changing any financial or history fields", async () => {
  const reads = actualOrderReads();
  const before = structuredClone(reads.response);
  const result = await reads.methods.listOrdersByUser("owner-1");
  assert.deepEqual(plain(result), plain([{ ...fixture, items: [withOrderItemProductImage(historicalItem)] }]));
  assert.deepEqual(reads.response, before);
  assert.equal(reads.queries.length, 1);
  const query = plain(reads.queries[0].query) as { where: unknown; include: { items: unknown }; orderBy: unknown };
  assert.deepEqual(query.where, { userId: "owner-1" });
  assert.deepEqual(query.include.items, { include: { product: { select: { slug: true, image: true,
    images: { select: { imageUrl: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: 1 } } } } });
  assert.deepEqual(query.orderBy, { createdAt: "desc" });
  assert.deepEqual(reads.summaryIds, []);
});

test("actual detail read retains owner isolation and WeChat merchant-order aliases while preserving refund summary", async () => {
  const reads = actualOrderReads();
  const result = await reads.methods.getOrderForUser("WX-PAYMENT-ALIAS", "owner-1");
  const query = plain(reads.queries[0].query) as { where: unknown; include: { items: unknown } };
  assert.deepEqual(query.where, { userId: "owner-1", OR: [{ orderNo: "WX-PAYMENT-ALIAS" },
    { paymentIntents: { some: { provider: "WECHAT_PAY", merchantOrderNo: "WX-PAYMENT-ALIAS" } } }] });
  assert.deepEqual(plain(result), plain({ ...fixture, items: [withOrderItemProductImage(historicalItem)],
    refundSummary: { fullyRefunded: true, succeededAmountCents: 4300 } }));
  assert.deepEqual(reads.summaryIds, [fixture.id]);
});

test("an absent or unauthorized detail returns null without a separate product or refund query", async () => {
  const reads = actualOrderReads({ missing: true });
  assert.equal(await reads.methods.getOrderForUser("OTHER-ORDER", "another-owner"), null);
  const query = plain(reads.queries[0].query) as { where: { userId: string } };
  assert.equal(query.where.userId, "another-owner");
  assert.equal(reads.queries.length, 1);
  assert.deepEqual(reads.summaryIds, []);
});

test("runtime reads and the shared write-path include remain unchanged", async () => {
  const reads = actualOrderReads({ storage: "runtime" });
  assert.equal((await reads.methods.listOrdersByUser("owner-1"))[0], reads.runtimeResponse);
  assert.equal(await reads.methods.getOrderForUser("ORDER-1", "owner-1"), reads.runtimeResponse);
  assert.deepEqual(reads.queries, []);
  assert.deepEqual(reads.summaryIds, []);
  assert.match(reads.source, /const orderInclude = \{\s+items: true,/);
});
