import { config } from '../config/index';

const CATALOG_CACHE_KEY = 'merchantkit.catalog.v4';
let memoryCatalog = null;

export function readCatalog() {
  try {
    const cached = memoryCatalog || wx.getStorageSync(CATALOG_CACHE_KEY);
    if (!cached || !Array.isArray(cached.products) || !cached.savedAt) return null;
    const age = Date.now() - cached.savedAt;
    if (!Number.isFinite(age) || age < 0 || age > config.catalogCacheMs) return null;
    if (cached.snapshotAt) {
      const snapshotAge = Date.now() - new Date(cached.snapshotAt).getTime();
      if (wx.getAccountInfoSync()?.miniProgram?.envVersion !== 'develop' || !Number.isFinite(snapshotAge) || snapshotAge < 0 || snapshotAge > 86400000) return null;
    }
    memoryCatalog = cached;
    return memoryCatalog;
  } catch (_error) {
    return null;
  }
}

export function writeCatalog(products, snapshotAt = '') {
  memoryCatalog = { products, snapshotAt, savedAt: Date.now() };
  // Public disk cache is optional; a full device must not discard live products.
  try { wx.setStorageSync(CATALOG_CACHE_KEY, memoryCatalog); } catch {}
}
