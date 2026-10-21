import { resolveContentImage } from '../utils/url';

function orderedVisibleSections(page) {
  const sections = page?.document?.sections;
  if (!Array.isArray(sections)) return [];
  return sections.filter((section) => section.visible !== false).sort((a, b) => a.sortOrder - b.sortOrder);
}

function normalizeTable(table, itemId) {
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) return null;
  return {
    headers: table.headers.map((text, index) => ({ id: `${itemId}-header-${index}`, text })),
    rows: table.rows.map((row, rowIndex) => ({
      id: `${itemId}-row-${rowIndex}`,
      cells: row.map((text, cellIndex) => ({ id: `${itemId}-cell-${rowIndex}-${cellIndex}`, text })),
    })),
  };
}

export function toNativeContentSections(page) {
  return orderedVisibleSections(page).map((section) => {
    const items = Array.isArray(section.items)
      ? section.items.map((item) => ({
        ...item,
        imageUrl: resolveContentImage(page.assets?.[item.mediaAssetId]?.url, page.key === 'home' && (section.columns || 2) > 1 ? 384 : 750),
        table: normalizeTable(item.table, item.id),
      }))
      : [];

    return {
      ...section,
      imageUrl: resolveContentImage(page.assets?.[section.mediaAssetId]?.url),
      items,
      slides: Array.isArray(section.slides)
        ? section.slides.map((slide) => ({
          ...slide,
          imageUrl: resolveContentImage(page.assets?.[slide.mediaAssetId]?.url),
        }))
        : [],
    };
  });
}

export function toHomeViewModel(page) {
  const sections = toNativeContentSections(page).map((section) => ({
    ...section,
    items: Array.isArray(section.items)
      ? section.items.map((item, index) => ({
        ...item,
        index: String(index + 1).padStart(2, '0'),
      }))
      : [],
  }));
  const hero = sections.find((section) => section.type === 'hero') || null;

  return {
    hero,
    sections: sections.filter((section) => section !== hero),
  };
}
