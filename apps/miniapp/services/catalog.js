import { normalizeProduct } from '../models/product';
import { readCatalog, writeCatalog } from '../stores/catalog';
import { request } from './http';
import { snapshot } from '../content/catalog-snapshot';

let catalogRequest = null;

export async function fetchProducts({ force = false } = {}) {
  if (!force) {
    const cached = readCatalog();
    if (cached) {
      getApp().globalData.catalogNotice = cached.snapshotAt
        ? '商品资料更新于 '+cached.snapshotAt.slice(0,10)+'，当前未能刷新。' : '';
      return cached.products;
    }
  }

  if (catalogRequest) return catalogRequest;
  catalogRequest = request({ path: '/api/products', retries: 0,headers:{'X-Quantity-Pricing':'repeat-bundles-v1'} })
    .catch((error) => {
      // A dated public catalog is allowed only in the IDE development build.
      // Trial/release builds must use the live API and never silently fall back.
      const develop = wx.getAccountInfoSync()?.miniProgram?.envVersion === 'develop';
      const age = Date.now() - new Date(snapshot.capturedAt).getTime();
      if (!develop || !Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) throw error;
      return { ok: true, products: snapshot.products, previewSnapshot: true };
    })
    .then((response) => {
      if (!response?.ok || !Array.isArray(response.products)) {
        throw new Error('INVALID_PRODUCT_RESPONSE');
      }

      const products = response.products.map(normalizeProduct);
      writeCatalog(products, response.previewSnapshot ? snapshot.capturedAt : '');

      const app = getApp();
      app.globalData.catalogNotice = response.previewSnapshot
        ? '商品资料更新于 '+snapshot.capturedAt.slice(0,10)+'，当前未能刷新。'
        : '';
      app.globalData.productCount = products.length;
      app.globalData.lastCatalogSyncAt = Date.now();
      return products;
    })
    .finally(() => {
      catalogRequest = null;
    });
  return catalogRequest;
}

export async function fetchProductBySlug(slug, options) {
  const products = await fetchProducts(options);
  return products.find((product) => product.slug === slug) || null;
}
