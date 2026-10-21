import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getProductDetailMedia } from "../../lib/product-detail-media";
import { resolvePublicProductImages, X1_AIR_WHITE_PRIMARY_IMAGE } from "../../lib/catalog-media";
import { ProductDetailArtwork } from "../../components/product/product-detail-artwork";
import { X1_PRODUCT_DETAIL_COPY } from "../../lib/product-detail-copy";

test("community artwork captions render in both languages without commercial material claims", () => {
  const images = getProductDetailMedia("x1-air-white");
  const regular = images.filter(image => image.style === "all");
  assert.deepEqual(regular.flatMap(image => image.detail ? [image.detail.number] : []), ["01", "02", "03"]);
  const regularHtml = renderToStaticMarkup(<ProductDetailArtwork images={regular} />);
  assert.equal(/莫代尔|新疆柔棉|柔软混纺/.test(regularHtml), false);
  for (const english of [false, true]) {
    const html = renderToStaticMarkup(<ProductDetailArtwork images={images} english={english} />);
    for (const copy of Object.values(X1_PRODUCT_DETAIL_COPY)) {
      assert.ok(copy);
      assert.ok(html.includes(english ? copy.bodyEn : copy.body));
      assert.ok(html.includes(english ? copy.titleEn : copy.title));
    }
    assert.equal(/10A|新疆|Xinjiang|antibacterial|柔软混纺/.test(html), false);
  }
});

test("the compact community detail set uses distinct responsive demo assets and stays separate from SKU photography", () => {
  const images = getProductDetailMedia("x1-air-white");
  assert.equal(images.length, 3);
  assert.equal(images.filter(image => image.style === "all").length, 3);
  assert.equal(images.filter(image => image.style === "upgraded").length, 0);
  assert.equal(new Set(images.map(image => image.url)).size, 3);
  assert.deepEqual(getProductDetailMedia("unrelated-product"), []);
  const html = renderToStaticMarkup(<ProductDetailArtwork images={images} />);
  assert.equal(html.includes('aria-label="升级款裆部说明"'), false);
  assert.equal((html.match(/loading="lazy"/g) || []).length, 3);
  assert.equal((html.match(/<source media="\(max-width: 767px\)"/g) || []).length, 3);
  assert.equal(html.includes("flatlay.jpg"), false);
});

test("international detail captions stay readable in English and do not add pricing or checkout", () => {
  const html = renderToStaticMarkup(<ProductDetailArtwork images={getProductDetailMedia("x1-air-white")} english />);
  assert.ok(html.includes('alt="Detail artwork example"'));
  assert.ok(html.includes("Product artwork"));
  assert.equal(html.includes('aria-label="Upgraded gusset only"'), false);
  assert.equal(/checkout|¥|CNY|USD/.test(html), false);
  assert.equal(renderToStaticMarkup(<ProductDetailArtwork images={[]} />), "");
});

test("supplied product angles are in the shared gallery while the existing primary and other products remain intact", () => {
  const images = resolvePublicProductImages("x1-air-white", []);
  assert.equal(images[0], X1_AIR_WHITE_PRIMARY_IMAGE);
  assert.equal(images.length, 8);
  assert.equal(images.slice(1, 5).every(image => image.includes("/vk-20261014/product-")), true);
  assert.equal(new Set(images).size, images.length);
  const custom = resolvePublicProductImages("x1-air-white", ["/uploads/current-primary.jpg", ...images]);
  assert.equal(custom[0], "/uploads/current-primary.jpg");
  assert.equal(new Set(custom).size, custom.length);
  assert.deepEqual(resolvePublicProductImages("unrelated-product", ["/uploads/example.jpg"]), ["/uploads/example.jpg"]);
  assert.equal(images.some(image => image.includes("gusset")), false);
});
