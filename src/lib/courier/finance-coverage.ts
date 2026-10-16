import { codBalance, money } from './finance';

/** No imported payment evidence is different from a confirmed zero payment. */
export function courierPaymentCoverage(expected: number | null, amounts: number[]) {
  if (!amounts.length) return {
    cod: expected === 0 ? 0 : null,
    codStatus: expected === 0 ? 'NOT_REQUIRED' as const : 'NO_STATEMENT' as const,
  };
  const cod = money(amounts.reduce((sum, amount) => sum + amount, 0));
  return { cod, codStatus: codBalance(expected, cod).status };
}

export const courierPaymentStatusLabel = {
  NOT_REQUIRED: 'Nema očekivanog pouzeća',
  NO_STATEMENT: 'Nije uvezena uplata',
  SETTLED: 'Usklađeno',
  SHORT: 'Manjak',
  EXCESS: 'Višak',
  UNKNOWN: 'Nepoznato očekivano pouzeće',
};
