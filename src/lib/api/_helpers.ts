import "server-only";
import { Prisma } from "@prisma/client";

/**
 * Coerce Prisma Decimal | bigint | null/undefined into a plain number for the
 * UI layer. Used by every read in this module.
 */
export function num(value: Prisma.Decimal | number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return value.toNumber();
}

export function numOrNull(
  value: Prisma.Decimal | number | bigint | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  return num(value);
}

/** Cap a positive integer page size with a sane upper bound. */
export function clampLimit(input: unknown, fallback: number, max: number) {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}
