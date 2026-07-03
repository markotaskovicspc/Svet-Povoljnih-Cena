import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

function withDatabaseSsl(connectionString: string) {
  const configuredSslMode = process.env.DATABASE_SSLMODE?.trim();
  try {
    const url = new URL(connectionString);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return connectionString;
    }
    const sslMode =
      configuredSslMode || url.searchParams.get("sslmode")?.trim() || "require";
    url.searchParams.set("sslmode", sslMode);
    if (configuredSslMode) {
      url.searchParams.delete("uselibpqcompat");
    }
    if (usesLibpqCompatibleSsl(sslMode)) {
      url.searchParams.set("uselibpqcompat", "true");
    }
    return url.toString();
  } catch {
    const sslMode = configuredSslMode || "require";
    const separator = connectionString.includes("?") ? "&" : "?";
    const compat = usesLibpqCompatibleSsl(sslMode)
      ? "&uselibpqcompat=true"
      : "";
    return `${connectionString}${separator}sslmode=${sslMode}${compat}`;
  }
}

function usesLibpqCompatibleSsl(sslMode: string) {
  return ["prefer", "require", "verify-ca"].includes(sslMode.toLowerCase());
}

const databaseUrl = [
  process.env.DATABASE_URL,
  process.env.POSTGRES_PRISMA_URL,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_URL_NON_POOLING,
].find((value) => value?.trim());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Use process.env directly so commands like `prisma validate` work
    // before a real DATABASE_URL is configured (CI, type-check, etc.).
    url: databaseUrl ? withDatabaseSsl(databaseUrl) : "",
  },
});
