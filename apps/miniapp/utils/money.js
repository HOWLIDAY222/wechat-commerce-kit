export function formatMoney(cents) { if(!Number.isSafeInteger(cents)) return ''; return '¥'+(cents/100).toFixed(2).replace(/\.00$/,''); }
