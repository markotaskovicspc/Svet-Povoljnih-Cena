import { signRequest } from './security.mjs';
export function createSpcClient(base, secret) {
  const url = new URL('/api/integrations/social',base);
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('SPC_HTTPS_REQUIRED');
  return async payload => {
    const body = JSON.stringify(payload);
    const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json',...signRequest(body,secret)},body,signal:AbortSignal.timeout(25000),redirect:'error'});
    if (!response.ok) throw new Error(`SPC_HTTP_${response.status}`);
    return response.json();
  };
}
