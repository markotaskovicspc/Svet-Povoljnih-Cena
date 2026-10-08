import { normalizeReturnParcelNumber, returnParcelNumbers, returnUnitParcelNumbers, type ReturnShipment } from './return-parcels';

export function reclamationParcelQuantity(shipment: ReturnShipment, item: { id: string; sku: string; qty: number }, code: string) {
  const canonical = normalizeReturnParcelNumber(code);
  const numbers = returnParcelNumbers(shipment);
  if (!numbers.includes(canonical)) throw new Error('Paket ne pripada ovoj reklamaciji.');
  if (numbers.length !== (shipment.packageCount ?? 1)) throw new Error('Nedostaju kodovi povratnih paketa. Proverite evidenciju.');
  if (numbers.length === 1) return item.qty;
  let quantity = 0;
  for (let unitNo = 1; unitNo <= item.qty; unitNo++) {
    const match = returnUnitParcelNumbers(item, [shipment], unitNo);
    if (!match.exact) throw new Error('Sadržaj paketa nije pouzdano povezan. Otvorite detalj reklamacije za ručnu proveru.');
    if (match.parcels.some(p => p.code === canonical)) quantity++;
  }
  if (!quantity) throw new Error('Paket nema povezanu količinu artikla.');
  return quantity;
}

/** Scanner suffixes are accepted only when the provider response proves the alias. */
export function canonicalReturnParcel(shipment: ReturnShipment, input: string) {
  const code = normalizeReturnParcelNumber(input);
  const numbers = returnParcelNumbers(shipment);
  if (numbers.includes(code)) return code;
  if (shipment.provider !== 'MYGLS') return null;
  const raw = shipment.rawCreateResponse;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const info = data.PrintLabelsInfoList ?? data.PrintDataInfoList;
  if (!Array.isArray(info)) return null;
  for (const row of info) {
    if (!row || typeof row !== 'object') continue;
    const aliases = [row.ParcelNumber, row.ParcelNumberWithCheckdigit].filter(v => typeof v === 'number' || typeof v === 'string').map(v => normalizeReturnParcelNumber(String(v)));
    if (aliases.includes(code)) return aliases.find(v => numbers.includes(v)) ?? null;
  }
  return null;
}
