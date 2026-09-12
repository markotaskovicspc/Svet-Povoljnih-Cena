# CUBE 210030 — lokalni 3D / AR, verzija 5

Braon sklopljena fotelja sa stranice https://www.svetpovoljnihcena.rs/p/100010-6b45ec.
Dimenzije: širina 80 cm, dubina 80 cm, visina 71 cm. Aktuelni registar koristi isključivo v5, izveden iz odobrenog v4 modela.

## Skladištenje isporučenih modela — Supabase Storage

Aktuelni GLB, USDZ i poster su u javnom bucket-u **`product-models`**, u projektu `vyebjbcfhgujlvjnoxpl`. Ključevi su `cube-210030/cube-v5.glb`, `cube-210030/cube-v5.usdz` i `cube-210030/poster-v4.webp`. Lokalni fajlovi ostaju radne kopije; GLB/USDZ pod `public/models/cube-210030/` su izuzeti iz Git-a. Binarni fajlovi ne ulaze u SQL tabele.

`src/lib/product-ar-storage.json` sadrži proverene javne adrese i uključuje se u commit sa integracijom. `src/lib/product-ar.ts` zadržava lokalni registar samo za braon CUBE. Nema migracije baze ni automatskog upload-a tokom build-a. Nakon push-a i uspešnog deploy-a, Vercel isporučuje aplikaciju, a pregledač i native AR preuzimaju model direktno iz Storage-a. Nije potrebna nova produkciona env promenljiva za ove adrese. Produkcioni deploy se izvršava standardnim push-om aplikacije na `main`; Storage upload je odvojen korak.

`node scripts/blender/publish-cube-storage.mjs` je ponovljiv upload samo pregledanih javnih fajlova. Koristi postojeće serverske Storage kredencijale iz `.env.local`, proverava SHA-256 posle anonimnog preuzimanja i odbija da pregazi drugačiji fajl pod istom verzijom. Bucket je ograničen na 10 MiB po fajlu i GLB/USDZ/WebP MIME tipove. Dodavanje/brisanje nije otvoreno kupcima; postojeće Storage policies nemaju INSERT/UPDATE/DELETE dozvole za njih. Drugi bucket-i nisu menjani.

Provereni su javni GET, identični SHA-256, MIME tipovi, CORS i HTTP Range (206). Keš je godinu dana; za izmenu koristiti novo verzionisano ime. Rezultati su u `qa/storage/`. Build i 5 unit testova prolaze. Browser provera: 29 prolaza u prvom prolazu, 2 preskočena i jedan problem brzog povratka sa fotografije na model; nakon ispravke taj slučaj prolazi u 3 ponavljanja, ukupno 30 različitih proverenih slučajeva. Izvorni `.blend`, reference i teksture ostaju u lokalnom autorskom direktorijumu; nisu postavljeni u javni bucket.

## Priprema pre klika — verzija aplikacije 6

Modeli ostaju v5, sa potpuno istim bajtovima tekstura i geometrije. Na prikazanoj galeriji, nakon učitavanja stranice i glavne fotografije, aplikacija čeka 800 ms i slobodan termin pa učita interfejs, lokalni runtime, model i pripremi materijale. Privremeni mali viewer je nevidljiv, inertan i uklanja se po završetku; ne ostaje aktivna render petlja. Klik prekida privremeni viewer i koristi pripremljeni model. Galerija i dalje prikazuje originalnu fotografiju dok kupac ne izabere 3D.

`saveData`, 2G/3G i uređaji koji prijavljuju najviše 2 GB RAM-a zadržavaju učitavanje na zahtev. Priprema ne počinje u skrivenom tabu ili za galeriju van viewport-a. Ovo menja ranije pravilo „uvek tek na klik”: pozadinsko preuzimanje na odgovarajućim vezama je namerno, radi bržeg otvaranja. USDZ se ne učitava unapred. Kod pozadinske greške, stvarni klik dobija nov ključ loader keša i može samostalno da uspe.

IKEA LACK model sa dostavljene stranice ima 46.340 B i koristi Draco geometriju i WebP teksture; stranica unapred učitava podatke o modelu i kod modala. U snimljenoj početnoj mreži nije viđeno preuzimanje samog GLB pre klika. Precizno vreme IKEA klika nije izmereno, jer otvaranje UI-a u headless sesiji nije bilo ponovljivo. Izvori: [proizvod](https://www.ikea.com/rs/sr/p/lack-zidna-polica-bela-50282177/), [javni model](https://web-api.ikea.com/rs/sr/rotera/static/models/50282177-mini.glb), [rotera script](https://www.ikea.com/global/assets/rotera/script-fragment-z8y6I6Aq.js). Svi lokalni nalazi su u `qa/v6/`.

Provere v6: 30 browser testova prolazi, 2 testa za telefon se preskaču u desktop projektu; build prolazi. Na simuliranoj vezi 4 Mbps / 150 ms, posle pozadinske pripreme klik do prikaza traje 714–779 ms, dok jedna hladna proba traje 5727 ms. Sama priprema je u ovim probama trajala 5,9–8,8 s pre klika, dok se fotografija već prikazivala; ovo vreme nije nestalo.

Merenje: `node scripts/blender/benchmark-cube-warmup.mjs`. Odvojeno beleži čekanje na pripremu pre klika i vreme od klika do prikaza. Ubrzanje pripremljenog modela ne znači da hladno preuzimanje nestaje; posao se obavi dok kupac gleda fotografiju. Simulacija telefona ne meri CPU i AR kameru stvarnog uređaja.

## Optimizacija brzine — verzija 5

- GLB 4.116.932 → 1.342.088 B (67,4% manji); USDZ 4.474.600 → 1.700.100 B (62,0% manji).
- Fotografski atlas ostaje 2048 × 2048, JPEG quality 94 sa 4:4:4 bojom. Izvori, boja, UV koordinate i sva geometrija ostaju iz v4; PNG izvornik ostaje u Blender projektu. Kompresija nije bez gubitaka: prosečna apsolutna RGB razlika teksture je 0,544/255, PSNR 49,47 dB. Razlika kontrolnog rendera GLB je 0,147/255, USDZ 0,130/255. Oba rendera su vizuelno pregledana.
- Lokalni `public/vendor/model-viewer/4.2.0/model-viewer.min.js` zamenjuje razvojni skup modula, sa pratećom licencom. Ne zavisi od javnog CDN-a. Model i runtime preuzimaju se istovremeno tek po izboru 3D; inicijalna fotografija i direktno AR dugme ne preuzimaju web model.
- Jedan zahtev za model proverava se browser testom dok je runtime namerno zadržan. Ugrađeni keš deli već učitan model između galerije i punog prikaza. Verzije v5 GLB/USDZ i 4.2.0 runtime imaju `public, max-age=31536000, immutable`; svaka buduća promena zahteva novo ime/verziju fajla.
- Simulacija u headless Chrome-u, hladni konteksti, 4 Mbps download i 150 ms latencije, dve probe po modelu: prethodni prosečno 10,37 s, novi 4,22 s do prikaza (~2,46×). Runtime je pre ove izolovane provere jednako učitan za oba modela. Ovo meri preuzimanje/dekodiranje/prikaz modela, ne otvaranje cele stranice i ne garantuje vreme na svakom telefonu. Lokalni puni klik do učitanog viewera u jednoj probi: 728 → 449 ms; to je orijentacioni lokalni podatak.
- ARKit/GLB validacije prolaze, dimenzije/pod su nepromenjeni. Proba na fizičkim telefonima nije izvršena.

Ponovljiva isporuka, nakon izrade izvornog v4:

```sh
node scripts/blender/optimize-cube-delivery.mjs
/tmp/cube-usd-venv/bin/python scripts/blender/optimize_cube_usdz.py
node scripts/blender/validate-cube-glb.mjs
/tmp/cube-usd-venv/bin/python scripts/blender/validate_cube.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/render_cube_roundtrip.py
node scripts/blender/benchmark-cube-loading.mjs
```

Završne provere v5: 20 browser testova i 5 unit testova prolaze; 2 testa za telefon se preskaču na desktop projektu. Build sa `VERCEL_ENV=development` prolazi.

Skripte ne menjaju `cube-corrected.blend` ni originalni PNG atlas. Izveštaji su u `qa/v5/`. Za raniji roundtrip postaviti `CUBE_EXPORT_VERSION=v4`. Pre optimizacije kopiranja vendor fajla mora biti instaliran zaključani `@google/model-viewer` 4.2.0.

Tehnička osnova: [glTF 2.0 slike podržavaju JPEG/PNG](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html); [model-viewer učitavanje](https://modelviewer.dev/examples/loading/). Za ovaj proizvod nisu dodati Draco/KTX dekoderi.

## Izvorni izgled — ispravka v4 prema originalnim fotografijama

Ponovo su pregledane sve četiri originalne fotografije u `references/`. Materijal verzije 4 koristi sedam odvojenih panela iz originala `01.webp` i `03.webp`, bez generisanih referenci i bez ponavljanja jednog malog uzorka preko cele fotelje. Prednji i bočni paneli uzeti su sa sklopljenog proizvoda; gornja tkanina sa jasnijeg prikaza rasklopljenog proizvoda. Smer vlakana prati odgovarajuće površine.

`panel-provenance-v4.json` beleži original, koordinate svakog četvorougla i konstantnu RGB korekciju osvetljenja po panelu. Perspektiva panela je ispravljena, a prosečna osvetljenost ujednačena. Nisu sintetisana nova rebra niti dodavane senke reljefa. Normal mapa je neutralna; mat roughness je procena, jer fotografije ne daju merenje površine. Osvetljenje prostora/pregledača utiče na nijansu.

Uklonjeni su dodatni obodni prstenovi šavova i prethodni pojačan reljef. Zaobljenje tri segmenta smanjeno je. Skrivena leva i zadnja strana ponovo koriste fotografisanu tkaninu; njihova konstrukcija ostaje procenjena. Ovo nije 3D sken i ne tvrdi se vernost nefotografisanih detalja.

## Izvorni fajlovi v4 (v5 nastaje kompresijom pri isporuci)

- `cube-corrected.blend`: lokalni Blender 5.2 izvor sa upakovanim originalima i teksturama.
- `../../scripts/blender/rebuild_cube_from_photos.py`: ponovljiva izrada v4; ne koristi generisane reference.
- `references/`: četiri originala i `sources.json`.
- `textures/v4-original-panel-atlas.png`: atlas originalnih panela, 2048 × 2048.
- `textures/v4-matte-roughness.png` i `v4-neutral-normal.png`: ugrađene pomoćne mape.
- `renders/v4-*.png`: kontrolni renderi i ponovo uvezeni izvozi.
- `../../public/models/cube-210030/cube-v4.glb`: web / Android, 4.117 MB.
- `../../public/models/cube-210030/cube-v4.usdz`: iPhone, 4.475 MB.
- `model-report-v4.json`, `glb-validation.json`, `usdz-validation.json`, `qa/v4/`: provere i poređenje izvoza.

Model ima 20.736 trouglova. Oba izvoza imaju ugrađene teksture, Y-up, metre i pod na Y=0. Izmereni obuhvat je 0,800000 × 0,710000 × 0,800000 m (X/Y/Z); tolerancija je 1 mm. GLB validator i USDZ ARKit compliance checker prolaze bez grešaka i upozorenja.

Raniji `.blend`, renderi, izvozi i `generated-references/` ostaju istorija; nisu aktivni model. Fajl je veći od v3 jer sada čuva zasebne fotografske panele, ali ostaje ispod 10 MB. Ne preuzima se pri prvom prikazu stranice.

## Ponovljiva lokalna izrada

Iz korena aplikacije `/Users/luka/svet povoljnih cena`:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/rebuild_cube_from_photos.py
node scripts/blender/prepare-cube.mjs
node scripts/blender/validate-cube-glb.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/render_cube_roundtrip.py
/tmp/cube-usd-venv/bin/python scripts/blender/validate_cube.py
```

Za novu USD instalaciju: `uv venv /tmp/cube-usd-venv --python python3.12`, zatim `uv pip install --python /tmp/cube-usd-venv/bin/python usd-core==25.11` i `/tmp/cube-usd-venv/bin/python scripts/blender/bootstrap_cube_usd.py`. Bootstrap vraća shader resurse zvaničnog OpenUSD v25.11 izvora koji nedostaju macOS wheel paketu; ne isključuje validaciju.

Provere v4: 5 unit testova i 16 browser testova prolaze; 2 testa za telefon se namerno preskaču na desktopu. Build prolazi sa `VERCEL_ENV=development`. Ponovni uvoz daje prosečnu RGB razliku 0,0025/255 za GLB i 3,946/255 za USDZ; mala razlika osvetljenja USD materijala je zabeležena, ne tvrdi se identičan render.

## Galerija i lokalni pregled

Originalna fotografija je prva. Pri dnu su „Pogledaj u svojoj sobi” i manje „3D” dugme. Biblioteka i model se pripremaju posle fotografije na odgovarajućim vezama (opis v6 iznad), ili na zahtev. Puni prikaz radi u viewport dijalogu na desktopu i telefonu; samo jedan viewer je aktivan. Web kamera je ograničena na 0–85° uz isključeno pomeranje cilja. Native AR kontrole određuje operativni sistem.

Desktop QR vodi na `/ar/100010-6b45ec`, poseban AR ulaz koji jednom pokušava automatsko pokretanje. Ako pregledač zahteva dodir, ostaje „Pokreni AR”. Android koristi Scene Viewer sa fiksnom veličinom, iPhone eksplicitni USDZ Quick Look. Automatsko otvaranje nije garantovano na svim telefonima.

Privremeni lokalni pregled: https://robert-sunglasses-director-chemical.trycloudflare.com/p/100010-6b45ec

```sh
.tools/cloudflared tunnel --url http://127.0.0.1:3024 --no-autoupdate
AR_PREVIEW_HOST=example.trycloudflare.com NEXT_PUBLIC_AR_PREVIEW_ORIGIN=https://example.trycloudflare.com NEXT_DIST_DIR=.next-cube VERCEL_ENV=development npm run dev -- --hostname 0.0.0.0 --port 3024
```

Zameniti primer stvarnim novim tunelskim hostname-om. Računar i oba procesa moraju ostati uključeni. Za produkciju nije potreban tunel; QR koristi origin produkcione stranice.

## Provere

```sh
npx vitest run tests/unit/product-ar.test.ts
E2E_LIVE_CATALOG=1 NEXT_PUBLIC_AR_PREVIEW_ORIGIN=https://robert-sunglasses-director-chemical.trycloudflare.com PLAYWRIGHT_BASE_URL=http://127.0.0.1:3024 npx playwright test tests/e2e/product-ar.spec.ts tests/e2e/ar-launcher.spec.ts --project=desktop --project=mobile
VERCEL_ENV=development npm run build
```

Fizička proba Android Chrome / iPhone Safari nije izvršena. Browser testovi proveravaju izbor fajla i AR poziv, ne kameru, detekciju poda ili stvarnu veličinu u sobi. Potrebno je ručno potvrditi ove stavke na oba uređaja.

## Istorija ranijih verzija

## Izmene — verzija 2

- Puni prikaz galerijskog modela u pristupačnom modalu preko celog viewport-a, na desktopu i telefonu. Otvoren je samo jedan viewer. Zatvaranje vraća fokus na dugme za proširenje; podržan je Escape.
- Web 3D kamera je ograničena na polarni ugao 0–85°, bez pan pomeranja, tako da nema pogleda ispod fotelje. Ovo ograničenje važi za web viewer i njegov puni prikaz; kontrole unutar izvornih Quick Look/Scene Viewer aplikacija određuje operativni sistem.
- QR otvara poseban AR ekran, bez prodajne galerije i korpe. Android dobija Scene Viewer `ar_only` intent i fiksnu skalu, iPhone direktan `rel=ar` USDZ link sa `allowsContentScaling=0`.
- AR ulaz odmah pokušava jedan native launch. Ako pregledač ne prenese korisničku aktivaciju iz QR skenera, ostaje „Pokreni AR” za jedan dodir. Android fallback koristi `?manual=1` da spreči petlju. Potpuno automatsko otvaranje nije garantovano na svim telefonima.
- Zvanična ograničenja: https://developer.chrome.com/docs/android/intents i https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look.
- `qa/v2/` sadrži rezultate novih provera. `qa/v1-poster.png` čuva izgled prethodnog materijala za poređenje. Raniji GLB/USDZ v1 ostaju dostupni, ali registar proizvoda koristi samo v2.

## Ranija verzija 3 — fotografija prva i učitavanje na zahtev

- Originalna fotografija je prva, uz lokalnu kopiju originala iz registra `photoUrl`. Model je poslednja, opciona stavka galerije. Prelazak mišem ili fokusom preko 3D sličice ne učitava model; aktivira se klikom ili izborom stavke.
- Pri dnu fotografije su „Pogledaj u svojoj sobi” i manje „3D” dugme, uz „Proverite kako se uklapa u vaš prostor”. Proizvod ima rezervisan prostor iznad dugmadi. AR dugme otvara QR / native AR bez prethodnog učitavanja web modela.
- Na prvom prikazu je potvrđeno **0 GLB/USDZ zahteva** i neregistrovana `model-viewer` komponenta, na desktopu i mobilnom prikazu. QR encoder se takođe učitava tek pri otvaranju dijaloga.
- Pojednostavljena regularna površinska mreža (18 × 18 umesto 26 × 26) ima 16.656 trouglova umesto 29.328. `cube-optimized.blend` je ponovljivo generisan iz istog opisa geometrije; `cube.blend` ostaje puna rezolucija.
- GLB: 2.611.132 → 2.242.500 bajtova. USDZ: 3.070.252 → 2.497.505 bajtova. Nema dodatnih mrežnih dekodera. Tri mape tkanine imaju identične dekodirane piksele i zadržavaju 1024 × 1024 rezoluciju.
- Između kontrolnog rendera pune i optimizovane geometrije prosečna apsolutna RGB razlika je 0,301/255. Izvoz i ponovni uvoz provereni; oba modela i dalje prolaze validaciju dimenzija, tekstura i poda.
- `qa/v3/` sadrži provere početnog učitavanja, screenshotove, logove i izveštaje. Porast prodaje nije pretpostavljen ni izmeren; za tu procenu potrebni su klikovi na AR/3D i konverzije u stvarnom saobraćaju.
