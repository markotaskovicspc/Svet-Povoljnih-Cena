import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Use process.env directly so commands like `prisma validate` work
    // before a real DATABASE_URL is configured (CI, type-check, etc.).
    url: process.env.DATABASE_URL ?? "",
  },
});
