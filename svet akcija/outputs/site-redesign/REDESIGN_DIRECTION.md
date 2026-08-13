# Svet Povoljnih Cena — premium street redesign

## Radni pravac: Court Culture / Action Club

Cilj je premium, moderan i bogat vizuelni identitet koji kombinuje energiju
street-basketball postera sa pouzdanošću ozbiljne internet prodavnice.

Marketing i storytelling površine mogu biti glasne: slojevi pocepanog papira,
halftone, screen-print teksture, linije terena, krupni serijski brojevi, cobalt i
signalno crveni akcenti. Kartice proizvoda, korpa, checkout, dostupnost i cene
ostaju mirni, jasni i veoma čitljivi.

### Paleta

- Midnight navy: `#07152B`
- Warm paper: `#F2EBDD`
- Electric cobalt: `#2450FF`
- Signal red: `#F0443A`
- Asphalt: `#17191D`
- Chrome: `#C8CDD5`

### Tipografija

- Bebas Neue: posteri, brojevi, stikeri i kratke poruke
- Playfair Display: premium editorial citati i ključne rečenice
- Inter: navigacija, proizvodi, cene, forme i duži tekst

## Početna stranica

1. Hero kao kampanjski poster, sa živim HTML naslovom i CTA dugmetom preko
   vizuala; tekst ne treba peći u generisanu sliku.
2. Sekcije proizvoda dobijaju krupne oznake `01`, `02`, `03`, drugačije
   pozadine i poster zaglavlja, ali same kartice ostaju čiste.
3. Između railova ubaciti editorial break blokove: manifest, kratku izjavu,
   novu kolekciju ili lice brenda.
4. Header zadržati funkcionalnim i mirnim, uz jači kontrast, tanju strukturu i
   jedan prepoznatljiv poster detalj.

## Stranica „O nama”

1. Full-bleed hero sa širokim collage backgroundom, jednim dominantnim
   portretom i dva manja candid kadra.
2. Kratak manifest umesto sadašnjeg dugog uvodnog pasusa.
3. Misija, vizija i način rada kao tri velike poster ploče, ne kao obični
   pasusi u jednoj koloni.
4. „Iza akcije” foto-zid: 4:5, 1:1 i 16:9 kadrovi složeni kao zalepljeni
   plakati, sa blagim rotacijama i dubinom.
5. Court-line timeline ili numerisani milestones.
6. Završni CTA ka ponudi ili kontaktu.

## Higgsfield tok za fotografije

1. Otpremiti 6–10 odobrenih fotografija: čist frontalni portret, 3/4 profil,
   full-body, dva candid kadra i nekoliko različitih izraza. Bez teških filtera,
   naočara koje pokrivaju oči i ekstremno različitih frizura/izgleda.
2. Od 3–5 najčistijih fotografija napraviti reusable character reference
   element. On trenutno ne postoji u povezanom Higgsfield workspace-u.
3. Generisati zasebne kompozicije za desktop `16:9`, mobile `9:16` i poster
   portret `4:5`. Lice i proporcije moraju ostati dosledni.
4. Ne generisati čitljiv tekst u slici. Naslovi, stikeri, brojevi i CTA ostaju
   HTML/CSS zbog oštrine, pristupačnosti i lakih izmena.
5. Finalne fajlove optimizovati u AVIF/WebP i ostaviti samo potrebne rezolucije.

## Higgsfield background draft v1

- Model requested: `nano_banana_pro`
- Model used by connector: `nano_banana_2`
- Format: `16:9`, 1376 × 768
- Cost: 2 Higgsfield credits

### Final prompt

```text
Use case: stylized-concept
Asset type: wide website About-page background, premium retail brand campaign
Primary request: Create a richly layered contemporary street-basketball editorial collage background for a Serbian e-commerce brand. It should feel premium, kinetic, tactile, and modern rather than minimalist.
Scene/backdrop: deep midnight navy and warm off-white poster wall with cobalt blue and signal-red accents, torn paper edges, wheat-paste seams, subtle concrete and asphalt grain, halftone dots, screen-print ink, basketball court arcs and measurement marks, chrome highlights, small abstract price-tag and receipt fragments used only as non-readable graphic shapes.
Composition/framing: wide 16:9 composition; concentrated energy around the perimeter and corners; preserve a calmer central-left and central-right zone so real portrait cutouts and live website copy can be layered later; strong diagonal rhythm and depth.
Lighting/mood: flash-photography energy, premium fashion-campaign polish, nocturnal arena atmosphere.
Constraints: background only; no people, no faces, no products, no brand logos, no legible words, no numbers, no watermark; avoid generic graffiti clichés, cartoon styling, luxury marble, and sterile minimalism.
```

## Implementacioni redosled

1. Zaključati art direction i izabrati fotografije.
2. Napraviti novu, namensku „O nama” prezentacionu komponentu i responsive
   photo slots, dok tekst i SEO ostaju vezani za postojeći CMS.
3. Redizajnirati homepage hero i jedan product rail kao pilot.
4. Proveriti desktop i mobile, performanse, kontrast i reduced-motion.
5. Tek nakon odobrenja proširiti sistem na ostale marketinške stranice.
