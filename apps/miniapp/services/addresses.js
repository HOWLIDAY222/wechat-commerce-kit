import { request } from './http';

export async function fetchAddresses() {
  const response = await request({ path: '/api/account/addresses', auth: 'required' });
  if (!response?.ok || !Array.isArray(response.addresses)) throw new Error('INVALID_ADDRESSES_RESPONSE');
  return response.addresses;
}

export async function createAddress(data) {
  const response = await request({ path: '/api/account/addresses', method: 'POST', data, auth: 'required' });
  if (!response?.ok || !response.address) throw new Error('INVALID_ADDRESS_RESPONSE');
  return response.address;
}

export async function updateAddress(addressId, data) {
  const response = await request({
    path: `/api/account/addresses/${encodeURIComponent(addressId)}`,
    method: 'PATCH',
    data,
    auth: 'required',
  });
  if (!response?.ok || !response.address) throw new Error('INVALID_ADDRESS_RESPONSE');
  return response.address;
}

export async function deleteAddress(addressId) {
  return request({
    path: `/api/account/addresses/${encodeURIComponent(addressId)}`,
    method: 'DELETE',
    auth: 'required',
  });
}
