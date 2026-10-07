// Images come only from the catalog, never from an URL supplied by the model.
export const dinars=value=>new Intl.NumberFormat('sr-Latn-RS',{maximumFractionDigits:2}).format(value)+' din';
export function productOffer(product){
  const ordinary=dinars(product.price);
  if(product.available===false)return `Trenutno nije dostupno za poručivanje.\nCena: ${ordinary}${product.loyaltyPrice>0&&product.loyaltyPrice<product.price?`; uz loyalty članstvo ${dinars(product.loyaltyPrice)}`:''}. Cena i dostupnost proveravaju se kada artikal ponovo stigne.`;
  if(!(product.loyaltyPrice>0&&product.loyaltyPrice<product.price))return `Cena: ${ordinary}.`;
  const loyalty=dinars(product.loyaltyPrice);
  return `Cena je ${ordinary}, a uz naš loyalty popust možete poručiti za samo ${loyalty}. 😊\nZa loyalty cenu potreban je Vaš pristanak za članstvo — članstvo je besplatno i ne obavezuje na kupovinu.\nDa li želite da poručite po ceni od ${loyalty}?`;
}
export function productPresentation(product) {
  const url=product.slug?`https://www.svetpovoljnihcena.rs/p/${encodeURIComponent(product.slug)}`:null;
  let imageUrl=null;
  try {
    const image=new URL(typeof product.image==='string'?product.image:product.image?.url);
    if(image.protocol==='https:' && !image.username && !image.password &&
      image.hostname==='vyebjbcfhgujlvjnoxpl.supabase.co' &&
      image.pathname.startsWith('/storage/v1/object/public/product-media/') && !image.search) imageUrl=image.href;
  } catch {}
  const caption=[`${product.name} (${product.sku})`,productOffer(product),url].filter(Boolean).join('\n');
  return {sku:product.sku,url,imageUrl,caption};
}
