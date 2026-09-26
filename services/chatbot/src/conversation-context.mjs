import {isOrderConfirmation} from './security.mjs';

export const HISTORY_LIMIT=120;
export function isOrderReceipt(message,orders=[]) {
  return message?.role==='assistant' && /^Porudžbina .+ je (?:uspešno|već) kreirana\./.test(message.content)
    && orders.some(o=>message.content.includes(o.number));
}
export function currentPurchaseHistory(state) {
  const history=state.history??[];
  const boundary=history.findLastIndex(m=>isOrderReceipt(m,state.orders));
  return history.slice(boundary+1);
}
export function repeatsCompletedOrder(state,text) {
  return isOrderConfirmation(text) && isOrderReceipt(state.history?.at(-1),state.orders);
}
export function customerFromQuote(input) {
  if(!input)return undefined;
  return {guestEmail:input.guestEmail,shipping:input.shipping,paymentMethod:input.paymentMethod,shippingMethod:input.shippingMethod};
}
