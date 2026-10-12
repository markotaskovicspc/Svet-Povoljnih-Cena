/** GLS numeric label: 11 digits plus a Modulo 10+1 control digit. */
export function myGlsBarcodeParcelNumber(input: string): string | null {
  const barcode = input.replace(/\s/g, "");
  // Leading zeroes are omitted in numeric API responses and canonical codes.
  if (!/^\d{11,12}$/.test(barcode)) return null;
  const padded = barcode.padStart(12, "0");
  const body = padded.slice(0, -1);
  const sum = [...body].reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 === 0 ? 3 : 1), 1);
  if ((10 - sum % 10) % 10 !== Number(padded.at(-1))) return null;
  return body.replace(/^0+(?=\d)/, "");
}
