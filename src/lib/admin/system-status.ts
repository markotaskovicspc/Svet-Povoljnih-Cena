import "server-only";

import { db, hasDatabaseConnection } from "@/lib/db";

type Environment = Readonly<Record<string, string | undefined>>;

type Requirement = {
  name: string;
  valid?: (value: string) => boolean;
};

export type IntegrationReadiness = {
  id: string;
  label: string;
  ready: boolean;
  missing: string[];
  description: string;
};

export type OperationsSnapshot = {
  checkedAt: string;
  database: {
    ok: boolean;
    latencyMs: number | null;
  };
  queues: {
    failedEmails: number;
    failedShipments: number;
    failedFiscalDocuments: number;
    failedBackgroundJobs: number;
    queuedBackgroundJobs: number;
  } | null;
  rabalux: {
    failedMediaJobs: number;
    retryMediaJobs: number;
    staleRuns: number;
    pendingApprovals: number;
    pendingMappings: number;
    lastCatalogSuccessAt: string | null;
    lastStockSuccessAt: string | null;
  } | null;
};

const enabledValues = new Set(["1", "true", "yes", "on"]);

function normalized(value: string | undefined) {
  const item = value?.trim();
  if (
    !item ||
    item.startsWith("GET_FROM_") ||
    item.includes("CHANGE_ME") ||
    item.toLowerCase().includes("placeholder")
  ) {
    return null;
  }
  return item;
}

function present(name: string): Requirement {
  return { name };
}

function enabled(name: string): Requirement {
  return {
    name,
    valid: (value) => enabledValues.has(value.toLowerCase()),
  };
}

function equals(name: string, expected: string): Requirement {
  return {
    name,
    valid: (value) => value.toLowerCase() === expected.toLowerCase(),
  };
}

function integration(
  env: Environment,
  input: Omit<IntegrationReadiness, "ready" | "missing"> & {
    requirements: Requirement[];
  },
): IntegrationReadiness {
  const missing = input.requirements
    .filter((requirement) => {
      const value = normalized(env[requirement.name]);
      return !value || (requirement.valid ? !requirement.valid(value) : false);
    })
    .map((requirement) => requirement.name);

  return {
    id: input.id,
    label: input.label,
    ready: missing.length === 0,
    missing,
    description: input.description,
  };
}

/**
 * Returns only boolean readiness and missing variable names. Environment
 * values, including credentials and secrets, never leave this server module.
 */
export function getIntegrationReadiness(
  env: Environment = process.env,
): IntegrationReadiness[] {
  return [
    integration(env, {
      id: "core",
      label: "Osnovni sistem",
      description: "Adresa sajta i osnovna zaštita servera i porudžbina.",
      requirements: [
        present("NEXT_PUBLIC_BASE_URL"),
        present("AUTH_SECRET"),
        present("CRON_SECRET"),
        present("ORDER_ACCESS_TOKEN_SECRET"),
        present("EMAIL_UNSUBSCRIBE_SECRET"),
      ],
    }),
    integration(env, {
      id: "rabalux",
      label: "Rabalux",
      description: "Dobavljački katalog, lager, mediji i dropshipping.",
      requirements: [
        enabled("RABALUX_ENABLED"),
        present("RABALUX_CATALOG_USER"),
        present("RABALUX_CATALOG_PASS"),
        present("RABALUX_STOCK_USER"),
        present("RABALUX_STOCK_PASS"),
      ],
    }),
    integration(env, {
      id: "resend",
      label: "Resend email",
      description: "Slanje porudžbina, potvrda i servisnih poruka.",
      requirements: [
        equals("EMAIL_PROVIDER", "resend"),
        present("RESEND_API_KEY"),
        present("RESEND_WEBHOOK_SECRET"),
        present("EMAIL_FROM"),
        present("EMAIL_REPLY_TO"),
      ],
    }),
    integration(env, {
      id: "mygls",
      label: "MyGLS",
      description: "Kreiranje pošiljki i praćenje isporuke.",
      requirements: [
        enabled("MYGLS_ENABLED"),
        enabled("MYGLS_PRODUCTION_ACCEPTED"),
        present("MYGLS_USERNAME"),
        present("MYGLS_PASSWORD"),
        present("MYGLS_CLIENT_NUMBER"),
        present("MYGLS_PICKUP_NAME"),
        present("MYGLS_PICKUP_STREET"),
        present("MYGLS_PICKUP_CITY"),
        present("MYGLS_PICKUP_POSTAL_CODE"),
        present("MYGLS_PICKUP_CONTACT_NAME"),
        present("MYGLS_PICKUP_CONTACT_PHONE"),
      ],
    }),
    integration(env, {
      id: "x-express",
      label: "X Express",
      description: "Alternativni kurir za male pošiljke.",
      requirements: [
        enabled("X_EXPRESS_ENABLED"),
        enabled("X_EXPRESS_PRODUCTION_ACCEPTED"),
        present("X_EXPRESS_BASE_URL"),
        present("X_EXPRESS_API_USER"),
        present("X_EXPRESS_API_KEY"),
        present("X_EXPRESS_CONTRACT_CODE"),
        present("X_EXPRESS_CHECK_ADDRESS_PATH"),
        present("X_EXPRESS_CREATE_ORDER_PATH"),
        present("X_EXPRESS_WEBHOOK_API_KEY"),
      ],
    }),
    integration(env, {
      id: "ips",
      label: "IPS / banka",
      description: "Plaćanje IPS QR kodom.",
      requirements: [
        enabled("IPS_PRODUCTION_ACCEPTED"),
        present("IPS_BASE_URL"),
        present("IPS_USER_ID"),
        present("IPS_TID"),
        present("IPS_PUBLIC_BASE_URL"),
        present("IPS_CALLBACK_URL"),
      ],
    }),
    integration(env, {
      id: "cards",
      label: "Kartice / banka",
      description: "Kartično plaćanje preko RaiAccept integracije.",
      requirements: [
        enabled("RAIACCEPT_PRODUCTION_ACCEPTED"),
        present("RAIACCEPT_PUBLIC_BASE_URL"),
        present("RAIACCEPT_MERCHANT_ID"),
        present("RAIACCEPT_TERMINAL_ID"),
        present("RAIACCEPT_CALLBACK_SECRET"),
      ],
    }),
    integration(env, {
      id: "badi",
      label: "BADI fiskalizacija",
      description: "Automatsko izdavanje fiskalnih računa.",
      requirements: [
        equals("FISCAL_PROVIDER", "badi"),
        enabled("BADI_PRODUCTION_ACCEPTED"),
        present("BADI_API_KEY"),
        present("BADI_API_SECRET"),
        present("FISCAL_TIN"),
        present("FISCAL_LOCATION_ID"),
      ],
    }),
  ];
}

export function externalMonitoringIsConnected(
  env: Environment = process.env,
) {
  return Boolean(
    normalized(env.BETTERSTACK_SOURCE_TOKEN) ||
      normalized(env.SENTRY_DSN) ||
      normalized(env.MONITORING_DSN),
  );
}

export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  const checkedAt = new Date().toISOString();
  if (!hasDatabaseConnection()) {
    return {
      checkedAt,
      database: { ok: false, latencyMs: null },
      queues: null,
      rabalux: null,
    };
  }

  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    return {
      checkedAt,
      database: { ok: false, latencyMs: null },
      queues: null,
      rabalux: null,
    };
  }

  const database = {
    ok: true,
    latencyMs: Date.now() - startedAt,
  };

  try {
    const [
      failedEmails,
      failedShipments,
      failedFiscalDocuments,
      failedBackgroundJobs,
      queuedBackgroundJobs,
      rabaluxSupplier,
      failedRabaluxMediaJobs,
      retryRabaluxMediaJobs,
      staleRabaluxRuns,
      pendingRabaluxApprovals,
      pendingRabaluxMappings,
      lastRabaluxCatalog,
      lastRabaluxStock,
    ] = await Promise.all([
      db.emailMessage.count({ where: { status: "FAILED" } }),
      db.shipment.count({ where: { status: "FAILED" } }),
      db.fiscalDocument.count({ where: { status: "FAILED" } }),
      db.backgroundJob.count({ where: { status: "FAILED" } }),
      db.backgroundJob.count({ where: { status: { in: ["QUEUED", "RETRY"] } } }),
      db.supplier.findUnique({
        where: { integrationKey: "RABALUX" },
        select: { id: true },
      }),
      db.backgroundJob.count({
        where: { kind: "RABALUX_MEDIA_PRODUCT", status: "FAILED" },
      }),
      db.backgroundJob.count({
        where: { kind: "RABALUX_MEDIA_PRODUCT", status: "RETRY" },
      }),
      db.importRun.count({
        where: {
          supplier: { integrationKey: "RABALUX" },
          status: "RUNNING",
          OR: [
            { heartbeatAt: { lt: new Date(Date.now() - 10 * 60_000) } },
            { heartbeatAt: null, startedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
          ],
        },
      }),
      db.product.count({
        where: {
          supplier: { integrationKey: "RABALUX" },
          supplierApprovalStatus: { in: ["PENDING_MAPPING", "PENDING_APPROVAL"] },
        },
      }),
      db.supplierSyncChange.count({
        where: {
          supplier: { integrationKey: "RABALUX" },
          changeType: "MAPPING_REQUIRED",
          status: "CONFLICT",
        },
      }),
      db.importRun.findFirst({
        where: {
          supplier: { integrationKey: "RABALUX" },
          kind: "CATALOG",
          status: "SUCCESS",
          dryRun: false,
        },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
      db.importRun.findFirst({
        where: {
          supplier: { integrationKey: "RABALUX" },
          kind: "STOCK",
          status: "SUCCESS",
          dryRun: false,
        },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
    ]);

    return {
      checkedAt,
      database,
      queues: {
        failedEmails,
        failedShipments,
        failedFiscalDocuments,
        failedBackgroundJobs,
        queuedBackgroundJobs,
      },
      rabalux: rabaluxSupplier
        ? {
            failedMediaJobs: failedRabaluxMediaJobs,
            retryMediaJobs: retryRabaluxMediaJobs,
            staleRuns: staleRabaluxRuns,
            pendingApprovals: pendingRabaluxApprovals,
            pendingMappings: pendingRabaluxMappings,
            lastCatalogSuccessAt: lastRabaluxCatalog?.finishedAt?.toISOString() ?? null,
            lastStockSuccessAt: lastRabaluxStock?.finishedAt?.toISOString() ?? null,
          }
        : null,
    };
  } catch {
    return { checkedAt, database, queues: null, rabalux: null };
  }
}
