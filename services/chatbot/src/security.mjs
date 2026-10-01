import {adReferral} from './ad-context.mjs';
import { createHmac, createHash, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function equal(a, b) {
  const x = Buffer.from(a ?? ''); const y = Buffer.from(b ?? '');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
export function verifyMeta(raw, signature, secret) {
  return Boolean(secret) && equal(signature, 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
}
export function signRequest(body, secret, now = Date.now()) {
  const timestamp = String(now);
  return { 'x-spc-timestamp': timestamp, 'x-spc-signature': createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex') };
}
export function seal(value, key) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function unseal(value, key) {
  const data = Buffer.from(value, 'base64'); const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
}
export function inWindow(timestamp, now = Date.now()) { return timestamp <= now + 60_000 && now - timestamp < 24 * 60 * 60_000; }
export function isConfirmation(text, code) {
  return typeof code === 'string' && text.trim().toUpperCase() === `POTVRĐUJEM ${code}`;
}
// Only a whole, affirmative message confirms the currently pending order.
// Reclamation confirmations keep their separate code-based contract.
export function isOrderConfirmation(text, code) {
  if (isConfirmation(text, code)) return true;
  const normalized=String(text).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'dj').replace(/[.!]+$/,'').trim();
  if (/^(?:(?:da|moze|vazi|potvrdjujem|potvrda|potvrdi|да|може|важи|потврђујем|потврда|потврди)[,\s]*)+$/.test(normalized)) return true;
  return /^(?:(?:da|moze|vazi)[,\s]+)?potvrdjujem (?:ovu )?porudzbinu$/.test(normalized);
}
export function parseEvents(body, accounts) {
  if (!['page', 'instagram'].includes(body?.object)) return [];
  const channel = body.object === 'page' ? 'facebook' : 'instagram';
  const events = [];
  for (const entry of body.entry ?? []) {
    const account=accounts.find(a => a.channel === channel && a.id === entry.id);
    if (!account) continue;
    for (const event of entry.messaging ?? []) {
      const referral=adReferral(event);
      if ((!event.message?.mid&&!referral) || !Number.isFinite(event.timestamp)) continue;
      const message=event.message??{};
      const referralOnly=!message.mid;
      const eventId=message.mid??('referral:'+createHash('sha256').update(JSON.stringify([entry.id,event.sender?.id,event.timestamp,referral])).digest('hex'));
      const echo = message.is_echo === true;
      if(echo&&event.sender?.id!==entry.id)continue;
      const sender = echo ? event.recipient?.id : event.sender?.id;
      if (!sender || (!echo && event.recipient?.id !== entry.id)) continue;
      events.push({ id: `${channel}:${eventId}`, channel, account: entry.id, sender,
        conversation: `${channel}:${entry.id}:${sender}`, timestamp: event.timestamp,
        echo, botEcho: message.metadata === 'spc-bot' || (echo && Boolean(account.appId) && String(message.app_id??'')===account.appId), sentByApp:Boolean(message.app_id), text: String(message.text ?? '').slice(0, 6000),
        referral: echo?null:referral,referralOnly,
        attachments: (message.attachments ?? []).slice(0, 5).map(a => ({type:a.type, url:a.payload?.url})),
      });
    }
  }
  return events;
}
