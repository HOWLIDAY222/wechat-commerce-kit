import { normalizeProduct } from '../models/product';
import { request } from './http';

export async function fetchFavorites() {
  const response = await request({ path: '/api/account/favorites', auth: 'required' });
  if (!response?.ok || !Array.isArray(response.favorites)) throw new Error('INVALID_FAVORITES_RESPONSE');
  return response.favorites.map(normalizeProduct);
}

export async function addFavorite(productSlug) {
  return request({
    path: '/api/account/favorites',
    method: 'POST',
    data: { productSlug },
    auth: 'required',
  });
}

export async function removeFavorite(productSlug) {
  return request({
    path: `/api/account/favorites/${encodeURIComponent(productSlug)}`,
    method: 'DELETE',
    auth: 'required',
  });
}
