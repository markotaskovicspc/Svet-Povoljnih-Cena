import { createHmac, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
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
  return ['da','potvrdjujem','potvrda','potvrdjujem porudzbinu','da potvrdjujem','da, potvrdjujem','moze','vazi','potvrdi','потврђујем','потврда','да','може','важи','потврди'].includes(normalized);
}
export function parseEvents(body, accounts) {
  if (!['page', 'instagram'].includes(body?.object)) return [];
  const channel = body.object === 'page' ? 'facebook' : 'instagram';
  const events = [];
  for (const entry of body.entry ?? []) {
    if (!accounts.some(a => a.channel === channel && a.id === entry.id)) continue;
    for (const event of entry.messaging ?? []) {
      if (!event.message?.mid || !Number.isFinite(event.timestamp)) continue;
      const echo = event.message.is_echo === true;
      const sender = echo ? event.recipient?.id : event.sender?.id;
      if (!sender || (!echo && event.recipient?.id !== entry.id)) continue;
      events.push({ id: `${channel}:${event.message.mid}`, channel, account: entry.id, sender,
        conversation: `${channel}:${entry.id}:${sender}`, timestamp: event.timestamp,
        echo, botEcho: event.message.metadata === 'spc-bot', text: String(event.message.text ?? '').slice(0, 6000),
        attachments: (event.message.attachments ?? []).slice(0, 5).map(a => ({type:a.type, url:a.payload?.url})),
      });
    }
  }
  return events;
}
