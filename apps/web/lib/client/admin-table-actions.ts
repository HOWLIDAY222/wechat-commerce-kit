export const adminTablePageSize = 10;

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

export function getPageCount(total: number, pageSize = adminTablePageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function getPageItems<T>(items: T[], page: number, pageSize = adminTablePageSize) {
  const safePage = Math.min(Math.max(page, 1), getPageCount(items.length, pageSize));
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function exportRowsAsCsv<T>(filename: string, rows: T[], columns: Array<CsvColumn<T>>) {
  const csv = [
    columns.map((column) => formatCsvCell(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => formatCsvCell(column.value(row))).join(",")),
  ].join("\r\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatCsvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
