import { describe,it,expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readSocialQuote, signSocialQuote, verifySocialRequest } from '../../src/lib/social/security';
describe('social integration trust boundary',()=>{
  const secret='a'.repeat(64);
  it('accepts only fresh body-bound signatures',()=>{
    const body='{"action":"search"}',now=1790250000000,ts=String(now);
    const signature=createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex');
    expect(verifySocialRequest(body,ts,signature,secret,now)).toBe(true);
    expect(verifySocialRequest(body+' ',ts,signature,secret,now)).toBe(false);
    expect(verifySocialRequest(body,ts,signature,secret,now+60001)).toBe(false);
    expect(verifySocialRequest(body,ts,signature,'',now)).toBe(false);
  });
  it('rejects tampering with confirmed price or buyer and wrong signing key',()=>{
    const payload={total:1234,conversationId:'facebook:123:456',input:{guestEmail:'test@example.com'}};
    const token=signSocialQuote(payload,secret);
    expect(readSocialQuote(token,secret)).toEqual(payload);
    const changed=Buffer.from(JSON.stringify({...payload,total:1})).toString('base64url');
    expect(()=>readSocialQuote(changed+'.'+token.split('.')[1],secret)).toThrow();
    expect(()=>readSocialQuote(token,'b'.repeat(64))).toThrow();
  });
});
