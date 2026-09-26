const cyrillic='абвгдђежзијклљмнњопрстћуфхцчџш';
const latin=['a','b','v','g','d','dj','e','z','z','i','j','k','l','lj','m','n','nj','o','p','r','s','t','c','u','f','h','c','c','dz','s'];
export function normalizePlace(value) {
  return String(value??'').trim().toLowerCase().replace(/[а-шђјљњћџ]/g,c=>latin[cyrillic.indexOf(c)]??c).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'dj').replace(/\s+/g,' ');
}
export function selectTown(items,shipping) {
  const matches=items.filter(t=>normalizePlace(t.name)===normalizePlace(shipping.city) && t.postalCode===shipping.postalCode.trim());
  const unique=[...new Map(matches.map(t=>[t.townId,t])).values()];
  return unique.length===1 && Number.isInteger(unique[0].townId) && unique[0].townId>0 ? unique[0] : null;
}
export function orderErrorMessage(code) {
  const reasons={
    DELIVERY_ADDRESS_INVALID:'Kurir nije prihvatio mesto ili adresu dostave. Proverimo tačno naselje i poštanski broj.',
    DELIVERY_UNAVAILABLE:'Izabrana dostava nije dostupna za ovu adresu ili artikle.',
    QUOTE_EXPIRED:'Ponuda je istekla. Potrebno je pripremiti novu ponudu za potvrdu.',
    PRICE_CHANGED:'Ukupan iznos se promenio. Potrebna je nova ponuda i vaša potvrda nove cene.',
    OUT_OF_STOCK:'Tražena količina više nije dostupna. Proverimo dostupnu količinu.',
    INACTIVE:'Artikal više nije dostupan za poručivanje.',
    PAYMENT_UNAVAILABLE:'Izabrani način plaćanja nije dostupan.',
    GUEST_REQUIRES_EMAIL:'Za porudžbinu je potreban vaš mejl.',
    LOYALTY_CONSENT_REQUIRED:'Potrebna je nova loyalty saglasnost, pa nova ponuda za potvrdu.',
  };
  return 'Porudžbina nije kreirana. '+(reasons[code]??'Sistem nije prihvatio porudžbinu. Potrebna je provera zaposlenog.');
}
