import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const ROLES = new Set(["SUPER", "CONTENT", "OPS", "ADS"]);

function withSslNoVerify(connectionString) {
  try {
    const url = new URL(connectionString);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return connectionString;
    }
    url.searchParams.set("sslmode", "no-verify");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    const separator = connectionString.includes("?") ? "&" : "?";
    return `${connectionString}${separator}sslmode=no-verify`;
  }
}

const rawConnectionString = [
  process.env.DATABASE_URL,
  process.env.POSTGRES_PRISMA_URL,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_URL_NON_POOLING,
].find((value) => value?.trim());
const connectionString = rawConnectionString
  ? withSslNoVerify(rawConnectionString)
  : undefined;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const role = process.env.ADMIN_ROLE?.trim().toUpperCase() || "SUPER";
const firstName = process.env.ADMIN_FIRST_NAME?.trim() || null;
const lastName = process.env.ADMIN_LAST_NAME?.trim() || null;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!connectionString) {
  fail(
    "Database connection string is required. Set DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL, or POSTGRES_URL_NON_POOLING.",
  );
}
if (!email) fail("ADMIN_EMAIL is required.");
if (!password) fail("ADMIN_PASSWORD is required.");
if (password.length < 8) fail("ADMIN_PASSWORD must be at least 8 characters.");
if (!ROLES.has(role)) fail(`ADMIN_ROLE must be one of: ${[...ROLES].join(", ")}.`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: ["error"],
});

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: {
      passwordHash,
      role,
      enabled: true,
      firstName,
      lastName,
    },
    create: {
      email,
      passwordHash,
      role,
      enabled: true,
      firstName,
      lastName,
    },
    select: {
      email: true,
      role: true,
      enabled: true,
    },
  });

  console.log(`Admin user ready: ${admin.email} (${admin.role}, enabled=${admin.enabled})`);
} finally {
  await prisma.$disconnect();
}
