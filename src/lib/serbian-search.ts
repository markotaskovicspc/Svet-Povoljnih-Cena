/** Comparison-only folding; keep the original spelling for display and storage. */
export function normalizeSerbianSearch(value: string): string {
  const cyrillic = "абвгдђежзијклљмнњопрстћуфхцчџш";
  const latin = ["a", "b", "v", "g", "d", "dj", "e", "z", "z", "i", "j", "k", "l", "lj", "m", "n", "nj", "o", "p", "r", "s", "t", "c", "u", "f", "h", "c", "c", "dz", "s"];
  return value
    .toLowerCase()
    .replace(/[а-шђјљњћџ]/g, (letter) => latin[cyrillic.indexOf(letter)] ?? letter)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj")
    .replace(/dj/g, "d");
}
