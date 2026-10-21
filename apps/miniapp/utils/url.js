import { config } from '../config/index';

export function resolveAssetUrl(value = '') {
  if (!value) return '';
  if (/^https:\/\//i.test(value)) return value;
  return `${config.websiteBaseUrl}${value.startsWith('/') ? value : `/${value}`}`;
}

export function resolveProductImage(value = '', width = 750) {
  const url = resolveAssetUrl(value);
  const prefix = `${config.websiteBaseUrl}/assets/catalog/`;
  if (!url.startsWith(prefix)) return url;
  const pathname = url.slice(config.websiteBaseUrl.length);
  if (/^\/assets\/catalog\/x1-air-white\/vk-20261014-packs\/pack-[1-4]-(256|384|750|1080)\.webp$/.test(pathname)) {
    return config.websiteBaseUrl + pathname.replace(/-(256|384|750|1080)\.webp$/, `-${[256,384,750,1080].includes(width)?width:750}.webp`);
  }
  if (width >= 750 && /^\/assets\/catalog\/x1-air-white\/vk-20261014\/product-(front|angle-a|angle-b|closeup)-(750|1080)\.webp$/.test(pathname)) {
    return config.websiteBaseUrl + pathname.replace(/-(750|1080)\.webp$/, width === 1080 ? '-1080.webp' : '-750.webp');
  }
  return `${config.websiteBaseUrl}/_next/image?url=${encodeURIComponent(pathname)}&w=${[256,384,750,1080].includes(width) ? width : 750}&q=75`;
}

export function resolveContentImage(value = '', width = 750) {
  const url = resolveAssetUrl(value);
  const prefix = `${config.websiteBaseUrl}/_next/image?url=`;
  if (!url.startsWith(prefix)) return url;
  const match = url.match(/[?&]url=([^&]+)/);
  let source = '';
  try { source = decodeURIComponent(match?.[1] || ''); } catch { return url; }
  if (!/^\/assets\/(campaign|catalog)\/[a-zA-Z0-9_./-]+\.(jpe?g|png)$/i.test(source) || source.split('/').includes('..')) return url;
  return `${prefix}${encodeURIComponent(source)}&w=${width === 384 ? 384 : 750}&q=75`;
}
