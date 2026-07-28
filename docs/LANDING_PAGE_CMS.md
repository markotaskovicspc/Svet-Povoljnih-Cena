# Landing page CMS — rad i QA

## Admin tok

1. Otvoriti `/admin/erp/landing-strane` i izabrati **Nova landing strana**.
2. Uneti slug, H1 naslov i uvod, pa sačuvati nacrt. Posle prvog čuvanja postaju dostupni upload i biblioteka slika.
3. Podesiti hero desktop/mobile sliku, alt tekst, CTA i do četiri piktograma.
4. Dodavati i ređati blokove: tekst, baner, proizvodi, piktogrami i CTA.
5. Popuniti SEO naslov/opis, canonical, OG sliku i robots odluku.
6. Po potrebi podesiti početak i kraj objave u lokalnom vremenu; editor ih čuva kao ISO vreme.
7. Sačuvati nacrt i otvoriti **Pregled nacrta**. Tek zatim izabrati **Objavi verziju**.

Čuvanje nacrta nikada ne menja poslednju objavljenu reviziju. Vraćanje stare verzije pravi novu draft reviziju, pa istorija ostaje neizmenjena. Ranije objavljen slug je zaključan. Nikada objavljen nacrt može da se obriše; objavljene strane se povlače ili arhiviraju.

## Blokovi i ograničenja

- Strana ima tačno jedan H1 iz hero sekcije. Rich-text blok prihvata H2/H3, Markdown liste i bezbedne linkove, ali ne prihvata raw HTML, Markdown slike ni H1.
- Slike prihvataju interni put ili HTTPS URL. Upload podržava JPG, PNG i WebP do 6 MB i 30 miliona piksela.
- CTA link prihvata interni put, anchor, HTTPS, `mailto:` ili `tel:`. Canonical pri objavi prihvata samo interni put ili HTTPS.
- Product picker prikazuje samo artikle koji zadovoljavaju centralnu storefront dostupnost. Redosled SKU-ova u editoru je redosled kartica na javnoj strani.
- Nevidljivi blokovi ostaju u nacrtu, ali se ne renderuju i ne blokiraju objavu zbog nedovršenog sadržaja.
- Objavljivanje proverava da svi izabrani proizvodi i piktogrami i dalje postoje i da su proizvodi dozvoljeni za web.

## Media i bezbednost

Landing slike se čuvaju u javnom `product-media` bucket-u pod `landing-pages/<page-id>/`. API zahteva CONTENT/SUPER admina, proverava da landing strana postoji, MIME, veličinu i stvarne dimenzije slike. Privatni bucket-i za račune, reklamacije i nalepnice se ne koriste.

## Kompatibilnost

Migracija `0036_landing_page_builder` pravi početnu reviziju za svaku postojeću landing stranu. Stari `LandingPageSection` zapisi se konvertuju u baner/product blokove pri prvom otvaranju i čuvanju u novom editoru. ERP modul „Legacy sekcije” ostaje read-only pregled.

Javna ruta koristi poslednju objavljenu reviziju. Za stare programski kreirane PUBLISHED redove bez revizije postoji privremeni direct/legacy fallback.

## Acceptance matrica

| Oblast | Provera | Očekivanje |
| --- | --- | --- |
| Lista | Otvaranje bez filtera | Nema beskonačnog loading loop-a; prazan rezultat ima poruku |
| CRUD | Novi nacrt | Redirect na detail editor, revizija 1 postoji |
| Draft/publish | Izmena objavljene strane + Save | Javna strana ostaje na prethodnoj reviziji |
| Publish | Objavi ispravan nacrt | Nova revizija je javna, cache/sitemap se osvežavaju |
| Schedule | Budući početak ili prošli kraj | Javna ruta vraća 404 i sitemap je izostavlja |
| Revision | Vrati staru verziju | Pravi se nova draft revizija; objavljena ostaje netaknuta |
| Slug | Promena posle prve objave | Server odbija promenu |
| SEO | Metadata | Title, description, canonical, robots, OG i Twitter imaju očekivane vrednosti |
| XSS/URL | Raw HTML, `javascript:`, protocol-relative URL | Objavljivanje/validacija odbija unos |
| Media | Pogrešan MIME, >6 MB ili prevelike dimenzije | Upload vraća kontrolisanu grešku |
| Proizvodi | Nepostojeći ili web-nedostupan SKU | Objavljivanje je blokirano |
| Responsive | Hero/banner mobile slika | Mobile slika ispod `md`, desktop slika od `md` naviše |
| Accessibility | Naslovi/slike/kontrole | Jedan H1, alt polja, label/aria-label i keyboard kontrole |
| Archive | Arhiviraj/povuci | Javna ruta 404, admin istorija ostaje |

## Rollout

1. Napraviti backup baze i deploy preview.
2. Pokrenuti standardni `npm run db:deploy` tok; on automatski pokreće `db:harden`.
3. Proveriti migrirane postojeće landing strane kroz admin preview.
4. Napraviti jednu internu `noindex` QA stranu sa svakim tipom bloka i proveriti desktop/mobile.
5. Objaviti QA stranu u kratkom terminu, proveriti metadata/sitemap/cache, zatim je arhivirati.
6. Tek posle acceptance provere pustiti production aplikaciju svim content adminima.

`ENFORCE_WEB_AUTO_AVAILABILITY` ostaje `false` dok DC zalihe ne budu uvezene i proverene. Landing product blokovi namerno koriste istu centralnu politiku dostupnosti kao ostatak prodavnice; promenu supplier-stock pravila i customer labela treba potvrditi sa klijentom.
