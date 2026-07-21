import "server-only";

import { db, hasDatabaseConnection } from "@/lib/db";

type Environment = Readonly<Record<string, string | undefined>>;

type Requirement = {
  name: string;
  aliases?: string[];
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

function presentOneOf(name: string, ...aliases: string[]): Requirement {
  return { name, aliases };
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
      const value = [requirement.name, ...(requirement.aliases ?? [])]
        .map((name) => normalized(env[name]))
        .find((item): item is string => Boolean(item));
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
  const hasVpfrCredentials = [
    "BADI_VPFR_PFX",
    "BADI_VPFR_PASSWORD",
    "BADI_VPFR_PAC",
  ].some((name) => normalized(env[name]));
  const badiMode = normalized(env.BADI_FISCAL_MODE)?.toLowerCase() ??
    (hasVpfrCredentials ? "vpfr" : "public");
  const badiModeRequirements = badiMode === "vpfr"
    ? [
        equals("BADI_FISCAL_MODE", "vpfr"),
        presentOneOf("BADI_STORE_ID", "BADI_CLIENT_ID"),
        presentOneOf("BADI_CASHIER_ID", "FISCAL_CASHIER"),
        present("BADI_VPFR_PFX"),
        present("BADI_VPFR_PASSWORD"),
        present("BADI_VPFR_PAC"),
      ]
    : [present("BADI_CLIENT_ID")];

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
        ...badiModeRequirements,
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
    ] = await Promise.all([
      db.emailMessage.count({ where: { status: "FAILED" } }),
      db.shipment.count({ where: { status: "FAILED" } }),
      db.fiscalDocument.count({ where: { status: "FAILED" } }),
      db.backgroundJob.count({ where: { status: "FAILED" } }),
      db.backgroundJob.count({ where: { status: { in: ["QUEUED", "RETRY"] } } }),
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
    };
  } catch {
    return { checkedAt, database, queues: null };
  }
}
