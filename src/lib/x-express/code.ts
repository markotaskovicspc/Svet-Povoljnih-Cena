import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  getXExpressConfig,
  X_EXPRESS_PROVIDER,
  XExpressConfigError,
} from "./config";

export function formatXExpressTrackingCode(prefix: string, value: number) {
  if (!/^[A-Z0-9]{2,10}$/.test(prefix)) {
    throw new XExpressConfigError("X Express prefiks mora biti alfanumerički.");
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new XExpressConfigError("X Express broj pošiljke nije validan.");
  }
  return `${prefix}${String(value).padStart(10, "0")}`;
}

export async function allocateXExpressTrackingCode(
  tx: Prisma.TransactionClient,
) {
  const cfg = getXExpressConfig();
  const rangeStart = cfg.codeRangeStart;
  const rangeEnd = cfg.codeRangeEnd;
  const prefix = cfg.codePrefix;
  if (rangeStart == null || rangeEnd == null || rangeStart > rangeEnd) {
    throw new XExpressConfigError("X Express opseg kodova nije ispravno podešen.");
  }

  const warningAt = Math.max(rangeStart, rangeEnd - 1000);
  await tx.$executeRaw`
    INSERT INTO "CourierCodeSequence"
      ("id", "provider", "prefix", "rangeStart", "rangeEnd", "nextValue", "warningAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${X_EXPRESS_PROVIDER}, ${prefix}, ${rangeStart}, ${rangeEnd}, ${rangeStart}, ${warningAt}, CURRENT_TIMESTAMP)
    ON CONFLICT ("provider", "prefix") DO UPDATE SET
      "rangeStart" = EXCLUDED."rangeStart",
      "rangeEnd" = EXCLUDED."rangeEnd",
      "warningAt" = EXCLUDED."warningAt",
      "nextValue" = GREATEST("CourierCodeSequence"."nextValue", EXCLUDED."rangeStart"),
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  const rows = await tx.$queryRaw<
    { value: number; rangeEnd: number; warningAt: number | null }[]
  >`
    UPDATE "CourierCodeSequence"
    SET "nextValue" = "nextValue" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "provider" = ${X_EXPRESS_PROVIDER}
      AND "prefix" = ${prefix}
      AND "nextValue" <= "rangeEnd"
    RETURNING
      "nextValue" - 1 AS "value",
      "rangeEnd" AS "rangeEnd",
      "warningAt" AS "warningAt"
  `;

  const allocated = rows[0];
  if (!allocated) {
    throw new XExpressConfigError("X Express opseg kodova je potrošen.");
  }

  return {
    value: allocated.value,
    trackingNo: formatXExpressTrackingCode(prefix, allocated.value),
    remaining: allocated.rangeEnd - allocated.value,
    belowWarning: allocated.warningAt != null && allocated.value >= allocated.warningAt,
  };
}
