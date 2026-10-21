import { toNativeContentSections } from './content';

// Only published merchant measurements may become size-specific advice.
export function sizeGuideView(page, size) {
  const sections = toNativeContentSections(page);
  const tips = sections.flatMap(section => section.items || [])
    .filter(item => item.body && !item.table)
    .map(item => ({ id: item.id, title: item.title || '', body: item.body }));
  const measurements = [];
  for (const section of sections) for (const item of section.items || []) {
    const table = item.table;
    if (!table) continue;
    const sizeColumn = table.headers.findIndex(header => /^(尺码|size)$/i.test(String(header.text).trim()));
    if (sizeColumn < 0) continue;
    const row = table.rows.find(row => String(row.cells[sizeColumn]?.text).trim().toUpperCase() === String(size).toUpperCase());
    if (!row) continue;
    table.headers.forEach((header, index) => {
      const value = row.cells[index]?.text;
      if (index !== sizeColumn && value) measurements.push({ label: header.text, value });
    });
  }
  return { guideTips: tips, sizeMeasurements: measurements };
}
