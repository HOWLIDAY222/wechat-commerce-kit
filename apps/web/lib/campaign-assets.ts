// Versioned, pre-sized assets avoid runtime transforms on a visitor's first request.
export function campaignAsset(name: "IMG_0606" | "IMG_0609") {
  const widths = name === "IMG_0606" ? [480, 768, 1280, 1920] : [480, 768, 1280, 1837];
  const path = (width: number) => `/assets/optimized/20260915/${name}-${width}.webp`;
  return { src: path(1280), srcSet: widths.map(width => `${path(width)} ${width}w`).join(", ") };
}
