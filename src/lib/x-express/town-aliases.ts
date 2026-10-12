// Customer locality -> verified provider routing town. Never create synthetic
// courier IDs: the API must also find this exact active provider record.
const BATAJNICA = {
  name: "Batajnica", postalCode: "11273",
  townId: 791059, townName: "Beograd (Zemun)",
  aliases: ["Batajnica", "Батајница", "Zemun Batajnica", "Beograd Batajnica", "Beograd Zemun Batajnica"],
};
// Postal locality 11185 belongs to Zemun; the provider routes this borough
// under its existing Beograd (Zemun) record, as for Batajnica above.
const ZEMUN_POLJE = {
  name: "Zemun polje", postalCode: "11185",
  townId: 791059, townName: "Beograd (Zemun)",
  aliases: ["Zemun polje", "Земун поље", "Beograd Zemun polje", "Beograd (Zemun polje)"],
};
// Žarkovo is a Čukarica locality; the active courier dictionary exposes the
// routing municipality as Beograd (Čukarica), 11030, id 791113.
const ZARKOVO = {
  name: "Žarkovo", postalCode: "11030",
  townId: 791113, townName: "Beograd (Čukarica)",
  aliases: ["Žarkovo", "Жарково", "Zarkovo", "Beograd Žarkovo", "Beograd Zarkovo", "Žarkovo BG", "Zarkovo BG", "Beograd (Žarkovo)"],
};
const aliases = [BATAJNICA, ZEMUN_POLJE, ZARKOVO];
function key(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function searchTownAliases(query: string) {
  const q = key(query);
  if (q.length < 3) return [];
  return aliases.filter(a => a.postalCode === q
    || a.aliases.slice(0,2).some(n => key(n).startsWith(q) && !(key(n).includes(" ") && key(n).split(" ")[0] === q))
    || a.aliases.some(n => key(n) === q));
}
export function exactTownAlias(city: string, postalCode?: string | null) {
  return aliases.find(a => (!postalCode || postalCode === a.postalCode) && a.aliases.some(n => key(n) === key(city)));
}
export function customerTownLabel(
  shipping: {city: string; postalCode: string},
  town: {id: number; name: string; postalCode: string | null} | null,
  options: {preserveCustomerPostalCode?: boolean} = {},
) {
  const alias = exactTownAlias(shipping.city, shipping.postalCode);
  if (alias && town?.id === alias.townId && town.name === alias.townName)
    return {city: alias.name, postalCode: options.preserveCustomerPostalCode ? shipping.postalCode : alias.postalCode};
  return {city: town?.name ?? shipping.city, postalCode: options.preserveCustomerPostalCode ? shipping.postalCode : town?.postalCode ?? shipping.postalCode};
}
