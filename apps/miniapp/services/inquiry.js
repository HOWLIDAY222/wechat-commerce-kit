import { request } from './http';

export function submitInquiry(payload) {
  return request({ path: '/api/contact', method: 'POST', data: payload });
}
