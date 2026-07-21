import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type ImportKind } from "@prisma/client";
import { db } from "@/lib/db";
import { isRabaluxSupplierOperational, RABALUX_INTEGRATION_KEY } from "./config";
import { prepareRabaluxPreview, type RabaluxPreviewSummary } from "./preview";

export type RabaluxSyncTarget = "catalog" | "stock" | "media";

export type RabaluxPreviewResult = {
  token: string;
  target: RabaluxSyncTarget;
  phrase: string;
  expiresAt: string;
  summary: RabaluxPreviewSummary;
};

const TARGET: Record<
  RabaluxSyncTarget,
  { kind: Exclude<ImportKind, "GENERIC">; phrase: string }
> = {
  catalog: { kind: "CATALOG", phrase: "KATALOG SYNC" },
  stock: { kind: "STOCK", phrase: "STOCK SYNC" },
  media: { kind: "MEDIA", phrase: "MEDIA SYNC" },
};

export function parseRabaluxSyncTarget(value: unknown): RabaluxSyncTarget | null {
  return value === "catalog" || value === "stock" || value === "media"
    ? value
    : null;
}

export async function createRabaluxSyncPreview(
  actorId: string,
  target: RabaluxSyncTarget,
): Promise<RabaluxPreviewResult> {
  const supplier = await db.supplier.findUniqueOrThrow({
    where: { integrationKey: RABALUX_INTEGRATION_KEY },
  });
  if (!isRabaluxSupplierOperational(supplier)) {
    throw new Error("Dobavljačka veza je isključena.");
  }
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `${id}.${secret}`;
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const targetConfig = TARGET[target];
  await db.importRun.create({
    data: {
      id,
      supplierId: supplier.id,
      kind: targetConfig.kind,
      dryRun: true,
      status: "RUNNING",
      requestedById: actorId,
    },
  });
  let summary: RabaluxPreviewSummary;
  try {
    summary = await prepareRabaluxPreview({ supplier, target, runId: id });
    const recordsRead =
      target === "catalog"
        ? summary.catalogRows
        : target === "stock"
          ? summary.stockRows
          : summary.diff.mediaPending;
    await db.importRun.update({
      where: { id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        recordsRead,
        recordsOk: recordsRead,
        sourceHash: summary.sourceHash,
        metadata: {
          actorId,
          target,
          tokenHash: hashToken(token),
          expiresAt: expiresAt.toISOString(),
          consumedAt: null,
          summary,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    await db.importRun.update({
      where: { id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        recordsFail: 1,
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : String(error),
      },
    });
    throw error;
  }
  return {
    token,
    target,
    phrase: targetConfig.phrase,
    expiresAt: expiresAt.toISOString(),
    summary,
  };
}

export async function consumeRabaluxSyncPreview(args: {
  actorId: string;
  target: RabaluxSyncTarget;
  token: string;
  phrase: string;
  reason: string;
}) {
  const targetConfig = TARGET[args.target];
  const reason = args.reason.trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new Error("Razlog mora imati između 5 i 500 znakova.");
  }
  if (args.phrase.trim() !== targetConfig.phrase) {
    throw new Error(`Unesite tačnu potvrdu: ${targetConfig.phrase}`);
  }
  const [runId] = args.token.split(".", 1);
  if (!runId || args.token.length > 200) {
    throw new Error("Preview potvrda nije važeća.");
  }
  const supplier = await db.supplier.findUniqueOrThrow({
    where: { integrationKey: RABALUX_INTEGRATION_KEY },
    select: { id: true, integrationKey: true, enabled: true },
  });
  if (!isRabaluxSupplierOperational(supplier)) {
    throw new Error("Dobavljačka veza je isključena.");
  }
  const consumed = await db.$queryRaw<Array<{ id: string; sourceHash: string | null }>>(Prisma.sql`
    UPDATE "ImportRun"
       SET "metadata" = "metadata" || jsonb_build_object(
         'consumedAt', NOW()::text,
         'reason', ${reason}::text
       )
     WHERE "id" = ${runId}
       AND "supplierId" = ${supplier.id}
       AND "dryRun" = TRUE
       AND "kind" = ${targetConfig.kind}::"ImportKind"
       AND "metadata"->>'actorId' = ${args.actorId}
       AND "metadata"->>'target' = ${args.target}
       AND "metadata"->>'tokenHash' = ${hashToken(args.token)}
       AND "metadata"->>'consumedAt' IS NULL
       AND ("metadata"->>'expiresAt')::timestamptz > NOW()
       AND NOT EXISTS (
         SELECT 1
           FROM "ImportRun" newer
          WHERE newer."supplierId" = "ImportRun"."supplierId"
            AND newer."kind" = "ImportRun"."kind"
            AND newer."dryRun" = FALSE
            AND newer."startedAt" > "ImportRun"."startedAt"
            AND newer."status" IN ('RUNNING', 'SUCCESS', 'PARTIAL')
       )
    RETURNING "id", "sourceHash"
  `);
  if (consumed.length !== 1) {
    throw new Error(
      "Preview potvrda je istekla, već je iskorišćena ili pripada drugom administratoru.",
    );
  }
  return { runId, reason, sourceHash: consumed[0].sourceHash };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}
