/**
 * Serbian places (gradovi i mesta) with postal codes.
 *
 * Curated subset covering all major cities and a wide selection of towns &
 * municipalities. Source: Pošta Srbije postal-code register (publicly
 * available). Add more entries as needed — the autocomplete is index-agnostic.
 *
 * The `name` field is the canonical Latinic spelling; aliases (Cyrillic,
 * common misspellings without diacritics) live in `aliases` so the matcher
 * still finds them.
 */
export interface SerbianPlace {
  /** Canonical place name (Latinic, with diacritics). */
  name: string;
  /** 5-digit postal code (Pošta Srbije). */
  postalCode: string;
  /** Optional alternate spellings (lowercased, no diacritics, etc.). */
  aliases?: string[];
}

export const SERBIAN_PLACES: SerbianPlace[] = [
  { name: "Ada", postalCode: "24430" },
  { name: "Aleksandrovac", postalCode: "37230" },
  { name: "Aleksinac", postalCode: "18220" },
  { name: "Apatin", postalCode: "25260" },
  { name: "Aranđelovac", postalCode: "34300", aliases: ["arandjelovac"] },
  { name: "Arilje", postalCode: "31230" },
  { name: "Babušnica", postalCode: "18330", aliases: ["babusnica"] },
  { name: "Bačka Palanka", postalCode: "21400", aliases: ["backa palanka"] },
  { name: "Bačka Topola", postalCode: "24300", aliases: ["backa topola"] },
  { name: "Bački Petrovac", postalCode: "21470", aliases: ["backi petrovac"] },
  { name: "Bajina Bašta", postalCode: "31250", aliases: ["bajina basta"] },
  { name: "Banatski Karlovac", postalCode: "26320" },
  { name: "Batočina", postalCode: "34227", aliases: ["batocina"] },
  { name: "Bečej", postalCode: "21220", aliases: ["becej"] },
  { name: "Bela Crkva", postalCode: "26340" },
  { name: "Bela Palanka", postalCode: "18310" },
  { name: "Beočin", postalCode: "21300", aliases: ["beocin"] },
  { name: "Beograd", postalCode: "11000", aliases: ["belgrade", "bgd"] },
  { name: "Beograd — Zemun", postalCode: "11080", aliases: ["zemun"] },
  { name: "Beograd — Novi Beograd", postalCode: "11070", aliases: ["novi beograd"] },
  { name: "Beograd — Voždovac", postalCode: "11010", aliases: ["vozdovac"] },
  { name: "Beograd — Zvezdara", postalCode: "11050", aliases: ["zvezdara"] },
  { name: "Beograd — Čukarica", postalCode: "11030", aliases: ["cukarica"] },
  { name: "Beograd — Palilula", postalCode: "11060" },
  { name: "Beograd — Rakovica", postalCode: "11090" },
  { name: "Beograd — Vračar", postalCode: "11118", aliases: ["vracar"] },
  { name: "Beograd — Savski venac", postalCode: "11040", aliases: ["savski venac"] },
  { name: "Bogatić", postalCode: "15350", aliases: ["bogatic"] },
  { name: "Bojnik", postalCode: "16205" },
  { name: "Boljevac", postalCode: "19370" },
  { name: "Bor", postalCode: "19210" },
  { name: "Bosilegrad", postalCode: "17540" },
  { name: "Brus", postalCode: "37220" },
  { name: "Bujanovac", postalCode: "17520" },
  { name: "Čačak", postalCode: "32000", aliases: ["cacak"] },
  { name: "Čajetina", postalCode: "31310", aliases: ["cajetina"] },
  { name: "Čoka", postalCode: "23320", aliases: ["coka"] },
  { name: "Crna Trava", postalCode: "16215" },
  { name: "Ćićevac", postalCode: "37210", aliases: ["cicevac"] },
  { name: "Ćuprija", postalCode: "35230", aliases: ["cuprija"] },
  { name: "Despotovac", postalCode: "35213" },
  { name: "Dimitrovgrad", postalCode: "18320" },
  { name: "Doljevac", postalCode: "18410" },
  { name: "Donji Milanovac", postalCode: "19220" },
  { name: "Gadžin Han", postalCode: "18240", aliases: ["gadzin han"] },
  { name: "Golubac", postalCode: "12223" },
  { name: "Gornji Milanovac", postalCode: "32300" },
  { name: "Inđija", postalCode: "22320", aliases: ["indjija"] },
  { name: "Irig", postalCode: "22406" },
  { name: "Ivanjica", postalCode: "32250" },
  { name: "Jagodina", postalCode: "35000" },
  { name: "Kanjiža", postalCode: "24420", aliases: ["kanjiza"] },
  { name: "Kikinda", postalCode: "23300" },
  { name: "Kladovo", postalCode: "19320" },
  { name: "Knić", postalCode: "34240", aliases: ["knic"] },
  { name: "Knjaževac", postalCode: "19350", aliases: ["knjazevac"] },
  { name: "Koceljeva", postalCode: "15220" },
  { name: "Kosjerić", postalCode: "31260", aliases: ["kosjeric"] },
  { name: "Kostolac", postalCode: "12208" },
  { name: "Kovačica", postalCode: "26210", aliases: ["kovacica"] },
  { name: "Kovin", postalCode: "26220" },
  { name: "Kragujevac", postalCode: "34000" },
  { name: "Kraljevo", postalCode: "36000" },
  { name: "Krupanj", postalCode: "15314" },
  { name: "Kruševac", postalCode: "37000", aliases: ["krusevac"] },
  { name: "Kučevo", postalCode: "12240", aliases: ["kucevo"] },
  { name: "Kula", postalCode: "25230" },
  { name: "Kuršumlija", postalCode: "18430", aliases: ["kursumlija"] },
  { name: "Lajkovac", postalCode: "14224" },
  { name: "Lapovo", postalCode: "34220" },
  { name: "Lazarevac", postalCode: "11550" },
  { name: "Lebane", postalCode: "16230" },
  { name: "Leskovac", postalCode: "16000" },
  { name: "Lešak", postalCode: "38218", aliases: ["lesak"] },
  { name: "Loznica", postalCode: "15300" },
  { name: "Lučani", postalCode: "32240", aliases: ["lucani"] },
  { name: "Majdanpek", postalCode: "19250" },
  { name: "Mali Iđoš", postalCode: "24321", aliases: ["mali idjos"] },
  { name: "Mali Zvornik", postalCode: "15318" },
  { name: "Malo Crniće", postalCode: "12311", aliases: ["malo crnice"] },
  { name: "Medveđa", postalCode: "16240", aliases: ["medvedja"] },
  { name: "Merošina", postalCode: "18252", aliases: ["merosina"] },
  { name: "Mionica", postalCode: "14242" },
  { name: "Mladenovac", postalCode: "11400" },
  { name: "Negotin", postalCode: "19300" },
  { name: "Niš", postalCode: "18000", aliases: ["nis"] },
  { name: "Nova Crnja", postalCode: "23218" },
  { name: "Nova Varoš", postalCode: "31320", aliases: ["nova varos"] },
  { name: "Novi Bečej", postalCode: "23272", aliases: ["novi becej"] },
  { name: "Novi Knjaževac", postalCode: "23330", aliases: ["novi knjazevac"] },
  { name: "Novi Pazar", postalCode: "36300" },
  { name: "Novi Sad", postalCode: "21000" },
  { name: "Obrenovac", postalCode: "11500" },
  { name: "Odžaci", postalCode: "25250", aliases: ["odzaci"] },
  { name: "Opovo", postalCode: "26204" },
  { name: "Osečina", postalCode: "14253", aliases: ["osecina"] },
  { name: "Padina", postalCode: "26215" },
  { name: "Paraćin", postalCode: "35250", aliases: ["paracin"] },
  { name: "Pančevo", postalCode: "26000", aliases: ["pancevo"] },
  { name: "Petrovac na Mlavi", postalCode: "12300" },
  { name: "Pirot", postalCode: "18300" },
  { name: "Plandište", postalCode: "26360", aliases: ["plandiste"] },
  { name: "Požarevac", postalCode: "12000", aliases: ["pozarevac"] },
  { name: "Požega", postalCode: "31210", aliases: ["pozega"] },
  { name: "Preševo", postalCode: "17523", aliases: ["presevo"] },
  { name: "Priboj", postalCode: "31330" },
  { name: "Prijepolje", postalCode: "31300" },
  { name: "Prokuplje", postalCode: "18400" },
  { name: "Rača", postalCode: "34210", aliases: ["raca"] },
  { name: "Raška", postalCode: "36350", aliases: ["raska"] },
  { name: "Ražanj", postalCode: "37215", aliases: ["razanj"] },
  { name: "Rekovac", postalCode: "35260" },
  { name: "Ruma", postalCode: "22400" },
  { name: "Senta", postalCode: "24400" },
  { name: "Sečanj", postalCode: "23240", aliases: ["secanj"] },
  { name: "Šabac", postalCode: "15000", aliases: ["sabac"] },
  { name: "Šid", postalCode: "22240", aliases: ["sid"] },
  { name: "Sjenica", postalCode: "36310" },
  { name: "Smederevo", postalCode: "11300" },
  { name: "Smederevska Palanka", postalCode: "11420" },
  { name: "Sokobanja", postalCode: "18230" },
  { name: "Sombor", postalCode: "25101" },
  { name: "Sopot", postalCode: "11450" },
  { name: "Srbobran", postalCode: "21480" },
  { name: "Sremska Mitrovica", postalCode: "22000" },
  { name: "Sremski Karlovci", postalCode: "21205" },
  { name: "Stara Pazova", postalCode: "22300" },
  { name: "Subotica", postalCode: "24000" },
  { name: "Surdulica", postalCode: "17530" },
  { name: "Svilajnac", postalCode: "35210" },
  { name: "Svrljig", postalCode: "18360" },
  { name: "Temerin", postalCode: "21235" },
  { name: "Titel", postalCode: "21240" },
  { name: "Topola", postalCode: "34310" },
  { name: "Trgovište", postalCode: "17525", aliases: ["trgoviste"] },
  { name: "Trstenik", postalCode: "37240" },
  { name: "Tutin", postalCode: "36320" },
  { name: "Ub", postalCode: "14210" },
  { name: "Užice", postalCode: "31000", aliases: ["uzice"] },
  { name: "Valjevo", postalCode: "14000" },
  { name: "Varvarin", postalCode: "37260" },
  { name: "Velika Plana", postalCode: "11320" },
  { name: "Veliko Gradište", postalCode: "12220", aliases: ["veliko gradiste"] },
  { name: "Vladičin Han", postalCode: "17510", aliases: ["vladicin han"] },
  { name: "Vladimirci", postalCode: "15225" },
  { name: "Vlasotince", postalCode: "16210" },
  { name: "Vranje", postalCode: "17500" },
  { name: "Vrbas", postalCode: "21460" },
  { name: "Vrnjačka Banja", postalCode: "36210", aliases: ["vrnjacka banja"] },
  { name: "Vršac", postalCode: "26300", aliases: ["vrsac"] },
  { name: "Žabalj", postalCode: "21230", aliases: ["zabalj"] },
  { name: "Žabari", postalCode: "12374", aliases: ["zabari"] },
  { name: "Žagubica", postalCode: "12320", aliases: ["zagubica"] },
  { name: "Žitište", postalCode: "23210", aliases: ["zitiste"] },
  { name: "Žitorađa", postalCode: "18412", aliases: ["zitoradja"] },
  { name: "Zaječar", postalCode: "19000", aliases: ["zajecar"] },
  { name: "Zrenjanin", postalCode: "23000" },
];

/** Strip diacritics + lowercase for fuzzy matching. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj");
}

/**
 * Fuzzy-search Serbian places by name (or postal code).
 * Returns matches that contain the query as a substring; results starting
 * with the query rank above those that contain it elsewhere.
 */
export function searchSerbianPlaces(
  query: string,
  limit = 8,
): SerbianPlace[] {
  const q = normalize(query.trim());
  if (q.length < 2) return [];

  const startsWith: SerbianPlace[] = [];
  const contains: SerbianPlace[] = [];

  for (const place of SERBIAN_PLACES) {
    const candidates = [normalize(place.name), ...(place.aliases ?? [])];
    let matched: "start" | "contain" | null = null;
    for (const c of candidates) {
      if (c.startsWith(q)) {
        matched = "start";
        break;
      }
      if (c.includes(q)) matched = "contain";
    }
    if (!matched && place.postalCode.startsWith(q)) {
      matched = "start";
    }
    if (matched === "start") startsWith.push(place);
    else if (matched === "contain") contains.push(place);
  }

  return [...startsWith, ...contains].slice(0, limit);
}
