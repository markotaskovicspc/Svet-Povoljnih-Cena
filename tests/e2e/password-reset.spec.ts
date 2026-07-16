import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { expect, test } from "@playwright/test";

const connectionString = process.env.E2E_DATABASE_URL;
test.skip(!connectionString, "Password-reset E2E requires an isolated E2E_DATABASE_URL.");

test("password reset consumes the link, revokes sessions and accepts the new password", async ({ page, context }, testInfo) => {
  const db = new Client({ connectionString });
  await db.connect();
  const id = randomUUID();
  const suffix = `${testInfo.project.name}-${testInfo.retry}`
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
  const email = `password-reset-${suffix}@example.test`;
  const oldPassword = "Old-E2e-Password-2026";
  const newPassword = "New-E2e-Password-2026";
  let token = "";

  try {
    await context.addCookies([{
      name: "spc_cookie_consent",
      value: "essential",
      url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    }]);
    await db.query(
      `INSERT INTO "User" ("id", "email", "passwordHash", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, email, await bcrypt.hash(oldPassword, 4)],
    );
    await db.query(
      `INSERT INTO "Session" ("id", "sessionToken", "userId", "expires") VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')`,
      [randomUUID(), randomUUID(), id],
    );

    await page.goto("/nalog/lozinka/zaboravljena");
    await page.getByLabel("E-pošta naloga").fill(email);
    await page.getByRole("button", { name: "Pošalji link" }).click();
    await expect(page.getByRole("status")).toContainText("Ako nalog postoji");

    const tokenRow = await db.query<{ token: string }>(
      `SELECT "token" FROM "VerificationToken" WHERE "identifier" = $1`,
      [`pwreset:${id}`],
    );
    expect(tokenRow.rows[0]?.token).toBeTruthy();
    token = randomBytes(32).toString("base64url");
    const digest = `sha256:${createHash("sha256").update(token, "utf8").digest("base64url")}`;
    await db.query(
      `UPDATE "VerificationToken" SET "token" = $1 WHERE "identifier" = $2`,
      [digest, `pwreset:${id}`],
    );

    await page.goto(`/nalog/lozinka/nova?token=${encodeURIComponent(token)}`);
    await page.getByLabel("Nova lozinka").fill(newPassword);
    await page.getByLabel("Potvrdite novu lozinku").fill(newPassword);
    await page.getByRole("button", { name: "Sačuvaj novu lozinku" }).click();
    await expect(page).toHaveURL(/\/nalog\/prijava\?reset=success/);
    const login = page.getByRole("main");
    await expect(login.getByRole("status").first()).toContainText("Lozinka je promenjena");

    const state = await db.query<{ passwordHash: string; sessionVersion: number; sessions: number }>(
      `SELECT u."passwordHash", u."sessionVersion", COUNT(s."id")::int AS sessions
         FROM "User" u LEFT JOIN "Session" s ON s."userId" = u."id"
        WHERE u."id" = $1 GROUP BY u."id"`,
      [id],
    );
    expect(state.rows[0]?.sessionVersion).toBe(1);
    expect(state.rows[0]?.sessions).toBe(0);
    expect(await bcrypt.compare(newPassword, state.rows[0]!.passwordHash)).toBe(true);

    await page.getByLabel("E-pošta").fill(email);
    await page.getByLabel("Lozinka").fill(newPassword);
    await login.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/nalog(?:\?|$)/);
  } finally {
    await db.query(`DELETE FROM "VerificationToken" WHERE "identifier" = $1`, [`pwreset:${id}`]);
    await db.query(`DELETE FROM "EmailMessage" WHERE "recipient" = $1`, [email]);
    await db.query(`DELETE FROM "User" WHERE "id" = $1`, [id]);
    await db.end();
  }
});
