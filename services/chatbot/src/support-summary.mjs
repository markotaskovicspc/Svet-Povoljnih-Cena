export function staffSummary(state){
 const p=state.staffPlanSummary;
 if(!p)return 'Dogovor nije pouzdano izdvojen. U nastavku je prepiska za proveru.';
 const s=p.shipping??{};
 return ['Prepoznati dogovor (porudžbina nije potvrđena):',
  p.lines.map(l=>`${l.sku} × ${l.qty}`).join(', '),
  ...(p.unitPrices??[]).map(l=>`Cena ${l.sku}: ${l.price} din`),
  p.agreedTotal!=null?`Dogovoreni ukupni iznos: ${p.agreedTotal} din`:'Ukupan iznos zahteva proveru.',
  `Dostava: ${[s.firstName,s.lastName,s.street,s.houseNumber,s.city,s.postalCode].filter(Boolean).join(' ')}`,
  `Telefon: ${s.phone??'nije izdvojen'}`,
  p.guestEmail?`Mejl: ${p.guestEmail}`:'Kupac nema naveden mejl (nije obavezan za kupovinu).'
 ].join('\n');
}
