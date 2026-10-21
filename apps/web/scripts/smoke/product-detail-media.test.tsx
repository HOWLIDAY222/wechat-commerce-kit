import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getProductDetailMedia } from "../../lib/product-detail-media";
import { resolvePublicProductImages, X1_AIR_WHITE_PRIMARY_IMAGE } from "../../lib/catalog-media";
import { ProductDetailArtwork } from "../../components/product/product-detail-artwork";
import { X1_PRODUCT_DETAIL_COPY } from "../../lib/product-detail-copy";

test("the six supplied descriptions render in both languages and material copy stays outside regular artwork", () => {
  const images = getProductDetailMedia("x1-air-white");
  const regular = images.filter(image => image.style === "all");
  assert.deepEqual(regular.flatMap(image => image.detail ? [image.detail.number] : []), ["01", "02", "03", "04", "05"]);
  const regularHtml = renderToStaticMarkup(<ProductDetailArtwork images={regular} />);
  assert.equal(/莫代尔|新疆柔棉|柔软混纺/.test(regularHtml), false);
  for (const english of [false, true]) {
    const html = renderToStaticMarkup(<ProductDetailArtwork images={images} english={english} />);
    for (const copy of Object.values(X1_PRODUCT_DETAIL_COPY)) {
      assert.ok(copy);
      assert.ok(html.includes(english ? copy.bodyEn : copy.body));
      assert.ok(html.includes(english ? copy.titleEn : copy.title));
    }
    const scope = html.indexOf(english ? 'aria-label="Upgraded gusset only"' : 'aria-label="升级款裆部说明"');
    assert.ok(html.indexOf(english ? "Soft fabric blend" : "柔软混纺面料") > scope);
  }
});

test("detail artwork is separate from the gallery and upgraded claims remain scoped to the gusset", () => {
  const images = getProductDetailMedia("x1-air-white");
  assert.equal(images.length, 12);
  assert.equal(images.filter(image => image.style === "all").length, 10);
  assert.equal(images.filter(image => image.style === "upgraded").length, 2);
  assert.equal(new Set(images.map(image => image.url)).size, 12);
  assert.deepEqual(getProductDetailMedia("unrelated-product"), []);
  const html = renderToStaticMarkup(<ProductDetailArtwork images={images} />);
  const scope = html.indexOf('aria-label="升级款裆部说明"');
  assert.ok(scope > 0);
  assert.equal(html.slice(0, scope).includes("upgraded-gusset-"), false);
  assert.ok(html.slice(scope).includes("仅用于升级款裆部"));
  assert.equal((html.match(/loading="lazy"/g) || []).length, 12);
  assert.equal((html.match(/<source media="\(max-width: 767px\)"/g) || []).length, 12);
  assert.equal(html.includes("flatlay.jpg"), false);
});

test("international detail captions stay readable in English and do not add pricing or checkout", () => {
  const html = renderToStaticMarkup(<ProductDetailArtwork images={getProductDetailMedia("x1-air-white")} english />);
  assert.ok(html.includes('alt="Contoured front"'));
  assert.ok(html.includes('aria-label="Upgraded gusset only"'));
  assert.ok(html.includes("apply to the upgraded gusset only"));
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
