export const productSections = ['overview', 'size', 'details'];

export function activeProductSection(positions, scrollTop, stickyHeight) {
  let active = 'overview';
  for (const key of productSections) {
    if (Number.isFinite(positions?.[key]) && positions[key] <= scrollTop + stickyHeight + 4) active = key;
  }
  return active;
}

export function sectionScrollTop(rectTop, currentScroll, stickyHeight) {
  return Math.max(0, Math.round(rectTop + currentScroll - stickyHeight + 2));
}
