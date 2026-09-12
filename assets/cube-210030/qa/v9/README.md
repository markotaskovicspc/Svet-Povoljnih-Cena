# CUBE v9 — ispravka odbijene v7

Luka je odbio i teksturu i oblik v7, a prihvatio X DESK v3. Ova promena menja samo CUBE. Registar i sva tri fajla stola ostaju isti.

Uklonjena je generisana, pravilno ponovljena tkanina i njen normal reljef. Tekstura je ponovo projektovana direktno sa originalnih `references/01.webp` i `03.webp`, sa većim obuhvatom prednjih površina nego u v6. Blender zatim peče fotografsku boju u jedan UV atlas. Korekcija boje i osvetljenja pre pečenja koristi linearne RGB faktore: prednji delovi (1,15; 1,22; 1,43), bočni (1,70; 2,00; 2,45), gornji pokrivač (1,85; 2,00; 2,30). Faktori su vizuelno kalibrisani poređenjem originala, neutralnog studija i web prikaza; nisu fizička merenja materijala. Probna v8 nije objavljena na stranici, jer je u browseru imala previše topao ton. Fotografske nepravilnosti ostaju sačuvane; nema novih generisanih rebara. Izvorne fotografije su zapakovane u .blend.

Oblik vraća kompaktniji sklop v6: visina donjih segmenata po 23,5 cm, naslon 23,7 cm i dubine 26 cm, uz poravnanje ukupne veličine na 80 × 80 × 71 cm. Uklonjeni su veći razmaci, jače zaobljenje i debeli pravilni rubovi v7. Dodati su tanki spojevi navlake poluprečnika 0,4 mm koji prate stvarnu površinu modela. Ovo je korekcija u odnosu na v7; osnovna geometrija je obnovljena iz v6, nije novi sken proizvoda.

Izvor: `assets/cube-210030/cube-photo-fidelity.blend`. Ponovljiva izrada: Blender 5.2 `scripts/blender/correct_cube_photo_fidelity.py`. Provere: `scripts/blender/validate-cube-photo.mjs`, OpenUSD `scripts/blender/validate_cube_photo_usdz.py`, Blender `scripts/blender/render_cube_photo_roundtrip.py`.

GLB: 1.368.300 bajta, 29.376 trouglova. USDZ: 1.869.304 bajtova. Ugrađena fotografska tekstura, metri, pod Y=0, dimenzije unutar 1 mm, bez grešaka i upozorenja u glTF i ARKit proveri. Oba formata su ponovo uvezena i pregledana pod istim studijskim svetlom.

Fotografije ograničavaju rezoluciju detalja. Skrivena leđa/leva strana koriste istu dokumentovanu rekonstrukciju. Tehnički prolazak testova nije potvrda da je Luka odobrio izgled. Fizičko AR postavljanje na Android/iPhone nije ponovljeno.

Konačni build (`VERCEL_ENV=development npm run build`) je prošao u čistom radnom stablu istog commita, sa samo ovom promenom. Osam unit testova za AR i ciljani ESLint su prošli. `browser/browser-review.json` beleži stvarno učitane javne fajlove kroz lokalnu aplikaciju: CUBE v9 i nepromenjeni X DESK v3; prateći snimci su iz model-viewer prikaza, ne Blender posteri.

Browser paket: 38 različitih testova prošlo, dve platformske kombinacije namerno preskočene. Prvi prolaz: 37 prolaza i jedan timeout u postojećem cookie helperu (`Samo nužni` je nestalo između isVisible i click); isti test ponovljen bez izmene i prošao za 6,2 s. Pokriveni su prvo fotografija, jedan transfer modela, greške/ponovni pokušaj, rotacija, pun ekran, zabrana pogleda odozdo, QR, Android/iPhone linkovi, proizvod bez modela i nepromenjeni sto. Browser prijavljuje postojeću CSP blokadu opcione WASM inicijalizacije; oba isporučena modela se uprkos tome učitavaju i prikazuju.
