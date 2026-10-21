import { resolveProductImage } from '../utils/url';
import { formatMoney } from '../utils/money';
import { normalizeDetailMedia } from './product-detail-media';

export function normalizeProduct(product) {
  const images = Array.isArray(product.images) ? product.images.map(value => resolveProductImage(value)).filter(Boolean) : [];
  const primaryImage = resolveProductImage(product.image) || images[0] || '';
  const release = product.release || {};
  // Shipment deadlines use the storefront's China calendar on every device.
  const shipDate = release.estimatedShipAt ? new Date(new Date(release.estimatedShipAt).getTime()+8*60*60*1000) : null;
  const shipLabel = shipDate && !isNaN(shipDate.getTime()) ? '预计 '+shipDate.getUTCFullYear()+'年'+(shipDate.getUTCMonth()+1)+'月'+shipDate.getUTCDate()+'日前发货' : '';
  const sizeOrder=['XS','S','M','L','XL','XXL'];
  product.sizes=(product.sizes||[]).slice().sort((a,b)=>sizeOrder.indexOf(a)-sizeOrder.indexOf(b));

  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant) => ({
      ...variant,
      priceLabel: formatMoney(variant.priceCents),
      compareAtPriceLabel: Number.isInteger(variant.compareAtPriceCents) && variant.compareAtPriceCents > variant.priceCents
        ? formatMoney(variant.compareAtPriceCents)
        : '',
      soldOut: Number(variant.availableQuantity || 0) <= 0,
    }))
    : [];
  const showPrice = Boolean(release.showPrice && Number.isInteger(product.minPriceCents));

  return {
    ...product,
    displayName: product.name,
    subtitle: product.summary,
    shipLabel,
    image: primaryImage,
    detailMedia:normalizeDetailMedia(product.detailMedia),
    cardImage: resolveProductImage(product.image, 384) || primaryImage,
    bagImage: resolveProductImage(product.image, 256) || primaryImage,
    images: images.length ? images : [primaryImage].filter(Boolean),
    previewImages: (Array.isArray(product.images) && product.images.length ? product.images : [product.image]).map(value => resolveProductImage(value,1080)).filter(Boolean),
    thumbImages: (Array.isArray(product.images) && product.images.length ? product.images : [product.image]).map(value => resolveProductImage(value, 256)).filter(Boolean),
    features: Array.isArray(product.features) ? product.features : [],
    colors: Array.isArray(product.colors) ? product.colors : [],
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    variants,
    priceLabel: showPrice ? formatMoney(product.minPriceCents) : '',
    showPrice,
    releaseLabel: release.statusLabel || '系列展示',
    isShowcase: release.status === 'SHOWCASE' || !release.purchasable,
    isPurchasable: Boolean(release.purchasable && variants.some((variant) => !variant.soldOut)),
  };
}
