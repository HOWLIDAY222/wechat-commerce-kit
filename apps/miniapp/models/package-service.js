export function packageCare(product) {
  if (!product || typeof product.careInstructions !== 'string') return null;
  const lines = product.careInstructions.split(/[；;。\r\n]+/).map(text => text.trim()).filter(Boolean);
  if (!lines.length) return null;
  return {
    title: product.displayName || product.name || '商品洗护',
    rows: lines.map((text, index) => ({ id: 'care-' + index, text })),
  };
}
