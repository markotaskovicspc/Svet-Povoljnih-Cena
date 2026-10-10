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
