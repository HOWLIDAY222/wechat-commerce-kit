import { readStorage, removeStorage, writeStorage } from '../utils/storage';

const searchHistoryKey = 'merchantkit.search-history';
const maxHistoryItems = 8;

export function readSearchHistory() {
  const value = readStorage(searchHistoryKey, []);
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeSearchTerm)
    .filter(Boolean)
    .slice(0, maxHistoryItems);
}

export function rememberSearch(term) {
  const normalized = normalizeSearchTerm(term);
  if (!normalized) return readSearchHistory();
  const next = [normalized, ...readSearchHistory().filter((item) => item.toLowerCase() !== normalized.toLowerCase())]
    .slice(0, maxHistoryItems);
  writeStorage(searchHistoryKey, next);
  return next;
}

export function clearSearchHistory() {
  removeStorage(searchHistoryKey);
  return [];
}

export function normalizeSearchTerm(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}
