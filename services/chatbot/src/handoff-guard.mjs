// Topics the seller answers alone (Marko, 13.11.2026). A handoff for them is
// refused with the answer rule, unless the customer explicitly asks for a person.
const fold=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'dj');

const ORDER_CONTEXT=/porudzbin|posiljk|paket|uplat|placen|naplat|reklamac|ostecen|polomljen|pokvar|ne radi|nedostaje|vracen|otkaz|kasn|nije stigl/;
// A product the seller could not identify from a picture is not "not in offer".
const UNIDENTIFIED=/vizuel|sa slike|sa poslate|poslat\w* slik|fotografij|kolaz|nije (?:pouzdano )?utvrdjen|nije utvrden|identit/;
const RULES=[
 {topic:'not_in_offer',test:r=>!ORDER_CONTEXT.test(r)&&!UNIDENTIFIED.test(r)&&/nije (?:pronadjen|pronaden|pronadjena|pronadena|u ponudi|dostupan|na stanju)|nema u ponudi|nema u katalogu|nemaju? rezultat|bez rezultat|nabav|nova zaliha|nove zalihe|ponovo (?:dostup|na stanju|u ponudi)|ponovna dostupnost|obavest|alternativ|slican|slicn|drugi model|veci model|visi model|vecu|vecom/.test(r),
  message:'Ne prosleđuj. Ako artikla nema u katalogu, reci kratko da ga trenutno nemamo u ponudi i da novitete objavljujemo na sajtu svetpovoljnihcena.rs i društvenim mrežama. Za sličan ili veći model sam pretraži katalog (2–3 pretrage) i prikaži do tri dostupna artikla; ako ih nema, reci to. Ne obećavaj nabavku ni obaveštenje.'},
 {topic:'courier',test:r=>/kurirsk\w* sluzb|kojom (?:brzom )?postom|kojim kurirom|post ?express|\bbex\b|d ?express|paketomat|cc paket|posta srbije|kosovo/.test(r)&&!/nije stigl|kasn|vracen|ostecen|platil|uplat|nema kreirane|status/.test(r),
  message:'Ne prosleđuj. Šaljemo isključivo kurirskim službama X Express i GLS; kurirsku službu određujemo mi. Ne šaljemo Poštom Srbije, BEX-om ni na paketomate, a dostava na Kosovo nije moguća.'},
 {topic:'warranty',test:r=>/garanc|garantn/.test(r)&&!/reklamac|ne radi|pokvar|ostecen/.test(r),
  message:'Ne prosleđuj. Garancija za sve naše artikle je 3 godine (2+1); garantni list stiže na mejl i ne traži registraciju. Uz svaku porudžbinu izdajemo fiskalni račun.'},
 {topic:'pickup',test:r=>/licn\w* preuzim|preuzim\w* licno|preuzeti u (?:magacin|prodavnic|sedist)|maloprodaj/.test(r),
  message:'Ne prosleđuj. Lično preuzimanje nije moguće; roba se isključivo dostavlja na adresu kurirskom službom.'},
 {topic:'colour',test:r=>/\bboj[aeiu]\b|colorprimary|nijans/.test(r)&&!/reklamac|stigl|pogresn|poslali|prepare_order|priprem\w* ponud/.test(r),
  message:'Ne prosleđuj. Govori samo o osnovnoj boji pod kojom je artikal u katalogu (polje boje); ako nisi siguran koju varijantu kupac želi, prikaži je alatom show_product i pitaj „Da li je ovo taj artikal?“.'},
 {topic:'phone',test:r=>/(?:trazi|zeli|dostav\w*|potreban|moli)[^.]{0,40}(?:broj telefona|kontakt telefon|telefonski kontakt|telefon (?:spc|prodavnic)|da (?:pozove|nazove))/.test(r)&&!/ne uspeva|nije stigl|ne moze da (?:posalje|zavrsi)/.test(r),
  message:'Ne prosleđuj. Ne dajemo broj telefona: kupac dobija pomoć ovde u razgovoru, a za porudžbinu ti prikupi podatke i pripremi ponudu.'},
 {topic:'ad_price',test:r=>!UNIDENTIFIED.test(r)&&/(?:oglas|reklami\b|reklama\b|reklamu\b|objav)[^;]{0,80}(?:cen|din|rsd)|cen[^;]{0,60}(?:oglas|reklami\b|reklama\b|reklamu\b|objav)/.test(r),
  message:'Ne prosleđuj. Važi aktuelna cena sa sajta i iz kataloga; oglas može biti stariji ili prikazivati loyalty cenu. Navedi aktuelnu cenu (i loyalty cenu ako je niža) i ponudi da poruči.'},
];
const ASKS_FOR_PERSON=/(?:covek|coveka|coveku|zaposlen|operater|ziv[ao]g? osob|prav[ao]g? osob|razgovarati sa nekim|nekim iz|nadlezn)/;

export function guardHandoff(reason,latestCustomerText=''){
 if(ASKS_FOR_PERSON.test(fold(latestCustomerText)))return null;
 const r=fold(reason);
 const rule=RULES.find(x=>x.test(r));
 return rule?{topic:rule.topic,message:rule.message}:null;
}
