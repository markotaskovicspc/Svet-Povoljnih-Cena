# Prodajni setovi i masovni uvozi

Scope: prodajni setovi, CSV/XLSX uvoz nabavnih cena i CSV/XLSX uvoz novih stavki nabavne porudžbenice.

- `/admin/erp/setovi`: nacrti/objava, 2–20 različitih postojećih artikala, količine i jedna prodajna cena; automatska raspodela cene na komponente u parama.
- `/setovi`: objavljeni setovi čije komponente zadovoljavaju postojeća pravila objave. Kupovina rezerviše stvarne komponente, a otkazivanje oslobađa njihove rezervacije. Isti artikal ne može biti u preklapajućim setovima ili samostalno uz set u istoj korpi. Gotova set porudžbina ne dozvoljava pojedinačne izmene sastava.
- `/admin/erp/nabavne-cene/uvoz`: do 500 redova/2 MB, šifra + nabavna cena + važenje od; opcioni kraj, valuta i dobavljač. Pregled i eksplicitna potvrda, bez prepisivanja postojeće cene istog datuma. Prethodni period se zatvara po postojećim pravilima.
- Detalj nabavne porudžbenice → Uvoz stavki: do 500 redova/500 KB, šifra + količina. Cene se uzimaju za sačuvani datum, dobavljača, valutu i paritet. Postojeće/duple šifre, MOQ i pakovanje proveravaju se pre primene.

Oba uvoza ponovo validiraju podatke pri primeni; upis je atomski i zaštićen od zastarelog pregleda. Prodajne cene i postojeći pojedinačni tokovi ostaju nepromenjeni. Nova migracija je aditivna i uključuje RLS za obe tabele setova; produkcijski build pokreće i db:harden.

Lokalna verifikacija 11.10.2026: 253 testa u 33 fokusirane datoteke; npm run build uspešan. Pravi Chromium browser, lokalni server i izdvojena QA šema: CSV/XLSX upisi, odbijanje grešaka/ponovnog uvoza, istorija cena (01.10–04.10 pa od 05.10), porudžbenica sa 4 stavke i zbirom 16.000 RSD. Set od 2.500,50 RSD uspešno poručen uz 299 RSD dostave; komponente 833,50 i 1.667 RSD; DC raspoloživo 50→49 i nakon otkazivanja 49→50, rezervacije 1→0. Test e-pošta i kurirski provajderi bili su isključeni.
