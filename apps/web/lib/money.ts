export function cents(amount: number) {
  return Math.round(amount * 100);
}

export function formatCents(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
  }).format(value / 100);
}
