/** Each generic ERP command is tied to its actual business module, not the URL chosen by its caller. */
const commandModules: Readonly<Record<string, readonly string[]>> = {
  "row.delete": ["artikli", "dobavljaci", "nabavne-cene", "ulazne-fakture", "landing-strane", "landing-sekcije", "newsletter-kampanje"],
  "article.create": ["artikli"], "lookup.create": ["sifarnici-artikala"], "supplier.create": ["dobavljaci"],
  "purchase-price.create": ["nabavne-cene"], "price-list.create": ["cenovnici"],
  "loyalty.create": ["loyalty"], "linear-promotion.create": ["linearne-promocije"],
  "warehouse.create": ["magacini"], "warehouse.archive": ["magacini"], "warehouse.restore": ["magacini"], "warehouse.delete": ["magacini"],
  "stocktake.create": ["popisi"], "stocktake.post": ["popisi"], "stocktake.archive": ["popisi"], "stocktake.restore": ["popisi"], "stocktake.delete": ["popisi"],
  "sales-order.delete": ["prodajni-nalozi"], "dispatch.delete": ["otpremnice"], "dispatch.post": ["otpremnice"], "dispatch.sef-send": ["otpremnice"],
  "pickup.create": ["preuzimanja"], "pickup.delete": ["preuzimanja"], "pickup.post": ["preuzimanja"],
  "customer.create": ["kupci"], "partner-client.create": ["partner-klijenti"],
  "landing.create": ["landing-strane"], "landing-section.create": ["landing-sekcije"], "newsletter.create": ["newsletter-kampanje"],
  "po-items.validate-packs": ["porudzbenice-po-artiklima"],
  "po.archive": ["porudzbenice"], "po.restore": ["porudzbenice"], "po.create": ["porudzbenice"], "po.send": ["porudzbenice"], "po.post": ["porudzbenice"], "po.receive": ["porudzbenice"],
  "invoice.create": ["ulazne-fakture"], "invoice.lock": ["ulazne-fakture"], "invoice.post": ["ulazne-fakture"], "invoice.cancel": ["ulazne-fakture"],
  "mp.proposal": ["mp-cene"], "mp.publish": ["mp-cene"],
};

export function isErpCommandBoundToModule(module: string, action: string) {
  return Object.prototype.hasOwnProperty.call(commandModules, action) && commandModules[action].includes(module);
}
