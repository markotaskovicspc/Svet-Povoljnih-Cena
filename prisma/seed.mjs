import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const connectionString = [
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.POSTGRES_PRISMA_URL,
  process.env.POSTGRES_URL,
].find((value) => value?.trim());

if (!connectionString) {
  throw new Error("db:seed requires DATABASE_URL or a configured Postgres fallback.");
}

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: withDatabaseSsl(connectionString),
    max: 1,
    connectionTimeoutMillis: 15_000,
  }),
});

const paymentMethods = [
  { method: "IPS", enabled: false, label: "Raiffeisen IPS" },
  { method: "KARTICA", enabled: false, label: "Platna kartica" },
  { method: "GOOGLE_PAY", enabled: false, label: "Google Pay" },
  { method: "APPLE_PAY", enabled: false, label: "Apple Pay" },
  { method: "UPLATA_NA_RACUN", enabled: true, label: "Uplata na račun" },
  { method: "POUZECE_GOTOVINA", enabled: true, label: "Pouzeće — gotovina" },
  { method: "POUZECE_KARTICA", enabled: true, label: "Pouzeće — kartica" },
];

try {
  await db.$transaction(async (tx) => {
    const defaultWarehouse = await tx.warehouse.findFirst({
      where: { active: true, isDefault: true },
      select: { id: true },
    });
    if (!defaultWarehouse) {
      await tx.warehouse.upsert({
        where: { code: "DC" },
        create: {
          code: "DC",
          name: "Distributivni centar",
          active: true,
          isDefault: true,
        },
        update: { active: true, isDefault: true },
      });
    }

    for (const method of paymentMethods) {
      await tx.paymentMethodConfig.upsert({
        where: { method: method.method },
        create: method,
        // Seeding fills missing baseline rows but never overwrites choices
        // already made by operations in the admin panel.
        update: {},
      });
    }
  });

  console.log(
    `db:seed: ensured a default warehouse and ${paymentMethods.length} payment method row(s).`,
  );
} finally {
  await db.$disconnect();
}

function withDatabaseSsl(raw) {
  const configuredSslMode = process.env.DATABASE_SSLMODE?.trim();
  const url = new URL(raw);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return raw;
  url.searchParams.set(
    "sslmode",
    configuredSslMode || url.searchParams.get("sslmode")?.trim() || "require",
  );
  if (configuredSslMode) url.searchParams.delete("uselibpqcompat");
  return url.toString();
}
