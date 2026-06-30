import "dotenv/config";
import { defineConfig } from "prisma/config";

function withVerifiedSsl(connectionString: string) {
  try {
    const url = new URL(connectionString);
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return connectionString;
    }
    url.searchParams.set("sslmode", process.env.DATABASE_SSLMODE ?? "verify-full");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    const separator = connectionString.includes("?") ? "&" : "?";
    return `${connectionString}${separator}sslmode=${
      process.env.DATABASE_SSLMODE ?? "verify-full"
    }`;
  }
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
    url: databaseUrl ? withVerifiedSsl(databaseUrl) : "",
  },
});
