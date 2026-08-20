export type WarehouseArchiveSnapshot = {
  name: string;
  isDefault: boolean;
  hasStock: boolean;
  hasOrderReservations: boolean;
  hasPartnerReservations: boolean;
  hasIncomingDocuments: boolean;
  hasOpenDispatches: boolean;
  hasOpenStockCounts: boolean;
};

export function warehouseArchiveBlocker(
  warehouse: WarehouseArchiveSnapshot,
): string | null {
  const label = `Magacin „${warehouse.name}”`;
  if (warehouse.isDefault) {
    return `${label} je podrazumevani magacin. Prvo postavite drugi aktivni magacin kao podrazumevani.`;
  }
  if (warehouse.hasStock) {
    return `${label} ima fizičko stanje. Pre arhiviranja prenesite ili uskladite zalihe na nulu.`;
  }
  if (warehouse.hasOrderReservations || warehouse.hasPartnerReservations) {
    return `${label} ima aktivne rezervacije. Pre arhiviranja ih završite ili oslobodite.`;
  }
  if (warehouse.hasIncomingDocuments) {
    return `${label} ima otvorenu nabavnu porudžbenicu ili prijemnicu. Pre arhiviranja završite ili otkažite dokument.`;
  }
  if (warehouse.hasOpenDispatches) {
    return `${label} se koristi na otvorenoj otpremnici. Pre arhiviranja završite ili otkažite otpremnicu.`;
  }
  if (warehouse.hasOpenStockCounts) {
    return `${label} ima otvoren popis. Pre arhiviranja završite ili otkažite popis.`;
  }
  return null;
}

export type WarehouseDeleteSnapshot = {
  name: string;
  active: boolean;
  isDefault: boolean;
  referenceCount: number;
};

export function warehouseDeleteBlocker(
  warehouse: WarehouseDeleteSnapshot,
): string | null {
  const label = `Magacin „${warehouse.name}”`;
  if (warehouse.active) {
    return `${label} je aktivan. Prvo ga arhivirajte.`;
  }
  if (warehouse.isDefault) {
    return `${label} je podrazumevani magacin i ne može se obrisati.`;
  }
  if (warehouse.referenceCount > 0) {
    return `${label} ima zalihe, kretanja ili povezane dokumente. Ostaće u arhivi radi očuvanja istorije.`;
  }
  return null;
}
