import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type ImportKind } from "@prisma/client";
import { db } from "@/lib/db";
import { logOperationalError } from "@/lib/monitoring";

export type RabaluxSyncScope = "CATALOG" | "STOCK" | "MEDIA";

const DEFAULT_LEASE_SECONDS = 10 * 60;
const GLOBAL_LEASE_SCOPE = "ALL";

export class RabaluxSyncBusyError extends Error {
  constructor(scope: RabaluxSyncScope) {
    super(`Rabalux ${scope.toLowerCase()} sync is already running.`);
    this.name = "RabaluxSyncBusyError";
  }
}

export class RabaluxCircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RabaluxCircuitBreakerError";
  }
}

export function stableSourceHash(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function configuredPositiveInt(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function configuredRatio(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

export function assertFeedBaseline(args: {
  kind: string;
  actual: number;
  absoluteMinimum: number;
  previousSuccessfulRows?: number | null;
}) {
  if (args.actual < args.absoluteMinimum) {
    throw new RabaluxCircuitBreakerError(
      `Rabalux ${args.kind} feed has ${args.actual} row(s); expected at least ${args.absoluteMinimum}.`,
    );
  }
  const previous = args.previousSuccessfulRows ?? 0;
  if (previous <= 0) return;
  const ratio = configuredRatio("RABALUX_MIN_BASELINE_RATIO", 0.9);
  const relativeMinimum = Math.ceil(previous * ratio);
  if (args.actual < relativeMinimum) {
    throw new RabaluxCircuitBreakerError(
      `Rabalux ${args.kind} feed shrank from ${previous} to ${args.actual} rows; safety threshold is ${relativeMinimum}.`,
    );
  }
}

export function assertSafeMissingShare(args: {
  kind: string;
  existing: number;
  missing: number;
  allowLargeRemoval?: boolean;
}) {
  if (!args.existing || !args.missing || args.allowLargeRemoval) return;
  const maximum = configuredRatio("RABALUX_MAX_MISSING_RATIO", 0.05);
  const ratio = args.missing / args.existing;
  if (ratio > maximum) {
    throw new RabaluxCircuitBreakerError(
      `Rabalux ${args.kind} feed omits ${args.missing}/${args.existing} existing products (${(
        ratio * 100
      ).toFixed(1)}%); maximum automatic share is ${(maximum * 100).toFixed(1)}%.`,
    );
  }
}

export function isRiskyPriceChange(previous: number, next: number) {
  if (previous <= 0 || next <= 0) return true;
  const threshold = Number(process.env.RABALUX_MAX_AUTO_PRICE_CHANGE_PCT ?? 10);
  const safeThreshold = Number.isFinite(threshold) && threshold >= 0 ? threshold : 10;
  return (Math.abs(next - previous) / previous) * 100 > safeThreshold;
}

export function missingGraceSatisfied(args: {
  nextCount: number;
  firstMissingAt: Date | null;
  now?: Date;
  confirmations: number;
  graceMs: number;
}) {
  const now = args.now ?? new Date();
  return Boolean(
    args.nextCount >= args.confirmations &&
      args.firstMissingAt &&
      now.getTime() - args.firstMissingAt.getTime() >= args.graceMs,
  );
}

export async function previousSuccessfulRowCount(
  supplierId: string,
  kind: Exclude<ImportKind, "GENERIC">,
  currentRunId?: string,
) {
  const run = await db.importRun.findFirst({
    where: {
      supplierId,
      kind,
      status: "SUCCESS",
      dryRun: false,
      ...(currentRunId ? { id: { not: currentRunId } } : {}),
    },
    orderBy: { finishedAt: "desc" },
    select: { recordsRead: true },
  });
  return run?.recordsRead ?? null;
}

export async function acquireSyncLease(args: {
  supplierId: string;
  runId: string;
  scope: RabaluxSyncScope;
}) {
  const leaseSeconds = configuredPositiveInt(
    "RABALUX_SYNC_LEASE_SECONDS",
    DEFAULT_LEASE_SECONDS,
  );
  const staleBefore = new Date(Date.now() - leaseSeconds * 1_000);
  const staleRuns = await db.importRun.findMany({
    where: {
      supplierId: args.supplierId,
      kind: args.scope,
      status: "RUNNING",
      id: { not: args.runId },
      OR: [
        { heartbeatAt: { lt: staleBefore } },
        { heartbeatAt: null, startedAt: { lt: staleBefore } },
      ],
    },
    select: { id: true },
  });
  if (staleRuns.length) {
    await db.importRun.updateMany({
      where: { id: { in: staleRuns.map(({ id }) => id) }, status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: "Recovered stale Rabalux sync after lease expiry.",
      },
    });
    logOperationalError(
      "rabalux.sync.stale_recovered",
      new Error("Recovered stale sync run."),
      { scope: args.scope, runIds: staleRuns.map(({ id }) => id) },
    );
  }

  const rows = await db.$queryRaw<Array<{ ownerRunId: string }>>(Prisma.sql`
    INSERT INTO "SupplierSyncLease" (
      "supplierId", "scope", "ownerRunId", "acquiredAt", "heartbeatAt", "expiresAt"
    ) VALUES (
      ${args.supplierId}, ${GLOBAL_LEASE_SCOPE}, ${args.runId}, NOW(), NOW(),
      NOW() + (${leaseSeconds} * INTERVAL '1 second')
    )
    ON CONFLICT ("supplierId", "scope") DO UPDATE SET
      "ownerRunId" = EXCLUDED."ownerRunId",
      "acquiredAt" = NOW(),
      "heartbeatAt" = NOW(),
      "expiresAt" = EXCLUDED."expiresAt"
    WHERE "SupplierSyncLease"."expiresAt" < NOW()
    RETURNING "ownerRunId"
  `);
  if (rows[0]?.ownerRunId !== args.runId) throw new RabaluxSyncBusyError(args.scope);
  await db.importRun.update({
    where: { id: args.runId },
    data: { heartbeatAt: new Date() },
  });
}

export async function heartbeatSyncLease(args: {
  supplierId: string;
  runId: string;
  scope: RabaluxSyncScope;
}) {
  const leaseSeconds = configuredPositiveInt(
    "RABALUX_SYNC_LEASE_SECONDS",
    DEFAULT_LEASE_SECONDS,
  );
  const updated = await db.supplierSyncLease.updateMany({
    where: {
      supplierId: args.supplierId,
      scope: GLOBAL_LEASE_SCOPE,
      ownerRunId: args.runId,
      expiresAt: { gt: new Date() },
    },
    data: {
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + leaseSeconds * 1_000),
    },
  });
  if (updated.count !== 1) throw new RabaluxSyncBusyError(args.scope);
  await db.importRun.update({
    where: { id: args.runId },
    data: { heartbeatAt: new Date() },
  });
}

export async function releaseSyncLease(args: {
  supplierId: string;
  runId: string;
  scope: RabaluxSyncScope;
}) {
  await db.supplierSyncLease.deleteMany({
    where: {
      supplierId: args.supplierId,
      scope: GLOBAL_LEASE_SCOPE,
      ownerRunId: args.runId,
    },
  });
}

export function reportCircuitBreaker(
  error: unknown,
  context: { runId: string; scope: RabaluxSyncScope },
) {
  if (error instanceof RabaluxCircuitBreakerError) {
    logOperationalError("rabalux.sync.circuit_breaker", error, context);
  }
}
