import { splitStreetAndHouseNumber } from "./house-number";

const cyrillic = Object.fromEntries(
  [..."абвгдђежзијклљмнњопрстћуфхцчџш"].map((letter, index) => [
    letter, ["a", "b", "v", "g", "d", "dj", "e", "z", "z", "i", "j", "k", "l", "lj", "m", "n", "nj", "o", "p", "r", "s", "t", "c", "u", "f", "h", "c", "c", "dz", "s"][index],
  ]),
);
function key(value: string) {
  return value.toLowerCase().replace(/[а-яђјљњћџ]/g, letter => cyrillic[letter] ?? letter).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj").replace(/[^\p{L}\p{N}]/gu, "");
}
// Verified equivalent street names, scoped to the town. Never fuzzy-match a
// different street or change the customer's house number/order snapshot.
const aliases = [{
  city: "Senta", canonical: "Ištvana Berte",
  names: ["Berta Istvan", "Berta Ištvana", "Ištvana Berte", "Ištvana Berta"],
}];
export function canonicalPickupStreet(street: string, city: string) {
  const alias = aliases.find(a => key(a.city) === key(city) && a.names.some(n => key(n) === key(street)));
  return alias?.canonical ?? street;
}
export function samePickupStreet(actual: string, expected: string, city: string) {
  return key(canonicalPickupStreet(actual, city)) === key(canonicalPickupStreet(expected, city));
}
export function pickupAddressLabel(address: { shipStreet: string; shipHouseNumber?: string | null; shipCity: string }) {
  const { street, houseNumber } = splitStreetAndHouseNumber(address.shipStreet, address.shipHouseNumber);
  return `${canonicalPickupStreet(street, address.shipCity)}${houseNumber ? ` (${houseNumber})` : ""}`;
}
