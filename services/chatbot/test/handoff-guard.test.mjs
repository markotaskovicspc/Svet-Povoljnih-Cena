import test from 'node:test';
import assert from 'node:assert/strict';
import {guardHandoff} from '../src/handoff-guard.mjs';

// Real handoff reasons, 14.10.–13.11.2026.
const answeredBySeller=[
 ['Kupac traži proveru da li ima povoljnih tepiha i koliko koštaju. Pretrage kataloga „tepih“ i „tep“ nemaju rezultate.','not_in_offer'],
 ['Kupac želi proveru kada se očekuje nova zaliha trpezarijskog stola HOME STYLE, šifra 110177, trenutno nedostupnog.','not_in_offer'],
 ['Kupac traži veću rernu zapremine 35–40 litara umesto BAKE MASTER 210007 (7 l).','not_in_offer'],
 ['Kupac želi 6 DIAMOND SEAT stolica (110088) i pita kojom kurirskom službom šaljemo.','courier'],
 ['Kupac pita da li je moguće slanje CC paketom Pošte Srbije.','courier'],
 ['Kupac traži proveru trajanja garancije za Fritezu FRY SMART – 6L, SKU 210025.','warranty'],
 ['Kupac pita da li je moguće lično preuzimanje friteze u Beogradu umesto dostave.','pickup'],
 ['Kupac želi 1 POWER MOP 110055 isključivo u crnoj boji. Opis navodi crnu, a polje boje ljubičastu.','colour'],
 ['Kupac traži broj telefona kako bi pozvao SPC. Molim korisničku podršku da dostavi važeći kontakt telefon.','phone'],
 ['Kupac ukazuje da reklama za ERGO LUX 110081 navodi 1.999 RSD, dok je aktuelna cena 4.284/loyalty 2.999 din.','ad_price'],
];
for(const [reason,topic] of answeredBySeller)test(`refused: ${topic}`,()=>assert.equal(guardHandoff(reason)?.topic,topic));

const forwarded=[
 'Kupac za SPC-2026-003338 navodi da je naručio u subotu, rok je 48 sati. Status je SPREMNO_ZA_ISPORUKU. Proveriti kašnjenje.',
 'Proveriti adresu za 4 DIAMOND SEAT 110088: priprema ponude odbija mesto bez kandidata.',
 'Kupac navodi da je robu platila pri poručivanju, ali je dobila poruku kurirske službe da pripremi tačan iznos.',
 'Kupkinja je unela adresu pri poručivanju, ali ne uspeva da pošalje porudžbinu. Traži broj telefona da pozove i poruči.',
 'Kupac navodi da naručena roba nije stigla već 5 dana i traži kontakt telefon da pozove.',
 'Proveriti ponudu za 1 crnu INFUSO 210011. Detalji potvrđuju crnu boju, ali prepare_order odbija povezivanje šifre.',
 'Kupac traži cenu šarene patchwork fotelje sa visokim naslonom iz objave i priložene slike. Vizuelna provera nema poklapanje.',
 'Aleksandra Vasilic traži kontakt zbog polomljenog seta BON APPETIT, porudžbina SPC-2026-002673.',
 'Komentar zahteva podršku zaposlenog',
];
for(const reason of forwarded)test(`forwarded: ${reason.slice(0,40)}`,()=>assert.equal(guardHandoff(reason),null));

test('an explicit request for a person is always forwarded',()=>{
 assert.equal(guardHandoff('Kupac pita kojom kurirskom službom šaljemo.','Hoću da razgovaram sa čovekom'),null);
});
