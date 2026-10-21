import { toHomeViewModel, toNativeContentSections } from '../models/content';
import { readLayout, readPage, writeLayout, writePage } from '../stores/content';
import { request } from './http';

const pageRequests = new Map();
const layoutRequests = new Map();

export async function fetchPublishedPage(pageKey, { force = false } = {}) {
  if (!force) {
    const cached = readPage(pageKey);
    if (cached) return cached;
  }

  if (pageRequests.has(pageKey)) return pageRequests.get(pageKey);
  const pending = loadPage(pageKey).finally(() => pageRequests.delete(pageKey));
  pageRequests.set(pageKey, pending);
  return pending;
}

async function loadPage(pageKey) {
  const response = await request({ path: `/api/miniprogram/pages/${encodeURIComponent(pageKey)}` });
  if (!response?.ok || !response.page?.document) {
    throw new Error('INVALID_CONTENT_RESPONSE');
  }

  const page = {...response.page, syncedAt: new Date().toISOString()};
  writePage(pageKey, page);
  return page;
}

export async function fetchPublishedLayout(layoutKey, { force = false } = {}) {
  if (!force) {
    const cached = readLayout(layoutKey);
    if (cached) return cached;
  }

  if (layoutRequests.has(layoutKey)) return layoutRequests.get(layoutKey);
  const pending = loadLayout(layoutKey).finally(() => layoutRequests.delete(layoutKey));
  layoutRequests.set(layoutKey, pending);
  return pending;
}

async function loadLayout(layoutKey) {
  const response = await request({ path: `/api/miniprogram/layouts/${encodeURIComponent(layoutKey)}` });
  if (!response?.ok || !response.layout?.document) {
    throw new Error('INVALID_LAYOUT_RESPONSE');
  }

  writeLayout(layoutKey, response.layout);
  return response.layout;
}

export { toHomeViewModel, toNativeContentSections };
