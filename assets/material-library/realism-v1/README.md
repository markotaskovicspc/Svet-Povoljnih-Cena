# CUBE v7 / X DESK v3 — 12.09.2026.

Izrada koristi četiri reference generisane ugrađenim Images/imagegen servisom, uz originalne fotografije proizvoda. Promptovi, polazne reference i izlazne slike su u `prompts.json` i `generated/`. To nisu fotografije stvarnog proizvoda: mikrotkanje, nevidljivi detalji i dubina šestougaonog udubljenja šrafa su procena. Originali imaju prednost. Generisana slika cele fotelje nije korišćena kao poster za lažni 3D prikaz.

CUBE: iznova napravljena spojena geometrija tri meka segmenta, blaga ispupčenost, rubovi i ugaoni šavovi navlake; fizički skalirane horizontalne pruge, rekonstruisana boja, normal i roughness. Procena koraka rebara je 10 mm, reljefa 0,8 mm. Za proveru su pregledani original 01, generisani detalj, studio i uvećani stvarni render. Model ima 38.304 trougla i dimenzije 80 × 80 × 71 cm. Detalji materijala računaju se iz generisanog uzorka visine; ovo nije fotogrametrijski sken niti ručno skulptovan visokopoligonalni original.

X DESK: svetli hrast dekor ima novi UV prostor na ploči, odvojeni raspon za panel i tanak pojas za kant. Sitni normal detalj ostaje plitak, jer fotografija i opis ne potvrđuju puno drvo. Crni ram zadržava prethodni Blendkit materijal. Šrafovi imaju zaobljen obod i stvarno udubljenje. Model ima 5.464 trougla i dimenzije 70 × 48 × 74 cm. Početni web ugao sada prikazuje lice stola sa vidljivim šrafovima.

## Ponovljiva lokalna izrada

Pokrenuti iz korena repozitorijuma, u Blenderu 5.2:

1. `Blender -b --python scripts/blender/rebuild_product_realism.py`
2. `node scripts/blender/optimize-realism-delivery.mjs`
3. Python sa OpenUSD: `scripts/blender/pack_realism_usdz.py`
4. `node scripts/blender/validate-realism-models.mjs` i OpenUSD Python `scripts/blender/validate_realism_usdz.py`
5. `Blender -b --python scripts/blender/render_realism_roundtrip.py`
6. `node scripts/blender/prepare-realism-posters.mjs` i `node scripts/blender/compare-realism-renders.mjs`

Za ponovni izvoz sačuvanog izvora bez nove rekonstrukcije: `scripts/blender/export_realism_models.py`. Izvori su `assets/cube-210030/cube-realism.blend` i `assets/x-desk-210027/x-desk-realism.blend`, sa zapakovanim slikama. Teksture u izvornom projektu zadržavaju PNG kvalitet; isporuka koristi zasebno proverenu kompresiju. GLB/USDZ fajlovi ostaju u lokalnom `public/models/` i javnom Storage bucketu `product-models`, izvan Git istorije.

## Provere

`glb-validation.json` i `usdz-validation.json`: oba formata bez grešaka/upozorenja; skala u metrima, Y nagore, pod na Y=0, dimenzije unutar 1 mm. USDZ prolazi ARKit compliance, sadrži nekompresovane ZIP članove sa poravnanjem na 64 bajta. Sve teksture su ugrađene. GLB je 2.779.140 / 1.229.988 bajtova, USDZ 3.271.166 / 1.163.488 bajtova (fotelja / sto).

Ponovni uvoz i render koriste istu kameru i svetlo: prosečna RGB razlika GLB prema izvoru je <0,05 od 255, a USDZ <2,25 od 255. USDZ Preview Surface malo drugačije prikazuje odsjaj; to nije potvrda identičnog izgleda na stvarnom iPhone-u. Uporedne slike su poređane: originalna fotografija, novi model, novi detalj. Fotografija i studio nemaju identično osvetljenje.

Web proverava mali manifest pri otvaranju i povratku u tab, kao i pri otvaranju 3D prikaza ako je prošlo 30 sekundi. Na promenu GLB adrese ponovo postavlja viewer, bez dva aktivna viewera. Korisnici kojima je stranica otvorena pre ove verzije aplikacije moraju je jednom osvežiti da dobiju ovaj mehanizam. Originalna fotografija ostaje prva i odmah dostupna; modeli se pripremaju nakon fotografije na odgovarajućim vezama, a Save Data/spore veze ostaju na učitavanju na zahtev.

Fizička proba na Android telefonu i iPhone-u nije izvršena. Ova promena modela ne dokazuje AR kompatibilnost neidentifikovanog Xiaomi telefona.
