import { config } from '../config/index';

const CONTENT_CACHE_PREFIX = 'merchantkit.content.v1.';
const LAYOUT_CACHE_PREFIX = 'merchantkit.layout.v1.';
const memoryPages = new Map();
const memoryLayouts = new Map();

export function readPage(pageKey, allowStale = false) {
  const memory = memoryPages.get(pageKey);
  if (memory && (allowStale || Date.now()-memory.savedAt <= config.contentCacheMs)) return memory.page;

  try {
    const cached = wx.getStorageSync(`${CONTENT_CACHE_PREFIX}${pageKey}`);
    if (!cached?.page || !cached.savedAt) return null;
    if (!allowStale && Date.now() - cached.savedAt > config.contentCacheMs) return null;
    memoryPages.set(pageKey, cached);
    return cached.page;
  } catch (_error) {
    return null;
  }
}

export function writePage(pageKey, page) {
  memoryPages.set(pageKey, {page,savedAt:Date.now()});
  // Keep the successful live result available when device storage is full.
  try { wx.setStorageSync(`${CONTENT_CACHE_PREFIX}${pageKey}`, { page, savedAt: Date.now() }); } catch {}
}

export function readLayout(layoutKey) {
  const memory = memoryLayouts.get(layoutKey);
  if (memory && Date.now()-memory.savedAt <= config.contentCacheMs) return memory.layout;

  try {
    const cached = wx.getStorageSync(`${LAYOUT_CACHE_PREFIX}${layoutKey}`);
    if (!cached?.layout || !cached.savedAt) return null;
    if (Date.now() - cached.savedAt > config.contentCacheMs) return null;
    memoryLayouts.set(layoutKey, cached);
    return cached.layout;
  } catch (_error) {
    return null;
  }
}

export function writeLayout(layoutKey, layout) {
  memoryLayouts.set(layoutKey, {layout,savedAt:Date.now()});
  try { wx.setStorageSync(`${LAYOUT_CACHE_PREFIX}${layoutKey}`, { layout, savedAt: Date.now() }); } catch {}
}
