import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

/**
 * Auxiliary auth flows that don't fit into the Auth.js providers:
 *
 * - `registerCustomer` — email + password sign-up, produces a User row
 *   that the Credentials provider can authenticate.
 * - `issuePhoneOtp` / `verifyPhoneOtp` — store a single-use SMS code in
 *   `VerificationToken` (identifier prefixed with `phone:`). The actual
 *   SMS dispatch lives in `src/lib/sms` (Phase 4).
 * - `createPasswordResetToken` / `consumePasswordResetToken` — magic-link
 *   reset flow keyed on email.
 */

const OTP_TTL_MS = 5 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

function secureUrlToken() {
  return randomBytes(32).toString("base64url");
}

export async function registerCustomer(input: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  isBusiness?: boolean;
  companyName?: string;
  pib?: string;
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing && !existing.deletedAt) {
    throw new Error("EMAIL_TAKEN");
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  const name =
    [input.firstName, input.lastName].filter(Boolean).join(" ") || null;

  const user = await db.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      name,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      isBusiness: input.isBusiness ?? false,
      companyName: input.companyName ?? null,
      pib: input.pib ?? null,
      emailVerified: null,
    },
    update: {
      passwordHash,
      name,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      isBusiness: input.isBusiness ?? false,
      companyName: input.companyName ?? null,
      pib: input.pib ?? null,
      deletedAt: null,
      emailVerified: null,
    },
  });

  await db.marketingConsent
    .upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    })
    .catch(() => undefined);

  return user;
}

export async function issuePhoneOtp(phoneRaw: string) {
  const phone = phoneRaw.replace(/\s+/g, "");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const identifier = `phone:${phone}`;
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: {
      identifier,
      token: code,
      expires: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  return { phone, code, expiresInSec: OTP_TTL_MS / 1000 };
}

export async function verifyPhoneOtp(phoneRaw: string, code: string) {
  const phone = phoneRaw.replace(/\s+/g, "");
  const token = await db.verificationToken.findFirst({
    where: { identifier: `phone:${phone}`, token: code },
  });
  return Boolean(token && token.expires > new Date());
}

export async function createPasswordResetToken(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.deletedAt) return null;

  const token = secureUrlToken();
  const identifier = `pwreset:${user.id}`;
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: {
      identifier,
      token,
      expires: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  return { token, userId: user.id };
}

export async function createEmailConfirmationToken(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, deletedAt: true },
  });
  if (!user?.email || user.deletedAt || user.emailVerified) return null;

  const token = secureUrlToken();
  const identifier = `email-confirm:${user.id}`;
  await db.verificationToken.deleteMany({ where: { identifier } });
  await db.verificationToken.create({
    data: {
      identifier,
      token,
      expires: new Date(Date.now() + EMAIL_CONFIRM_TTL_MS),
    },
  });
  return { token, email: user.email, userId: user.id, expiresInHours: 24 };
}

export async function consumePasswordResetToken(token: string, newPassword: string) {
  const record = await db.verificationToken.findUnique({ where: { token } });
  if (!record || !record.identifier.startsWith("pwreset:")) return false;
  if (record.expires < new Date()) {
    await db.verificationToken.delete({ where: { token } });
    return false;
  }
  const userId = record.identifier.slice("pwreset:".length);
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash } }),
    db.verificationToken.delete({ where: { token } }),
  ]);
  return true;
}

export async function consumeEmailConfirmationToken(token: string) {
  const record = await db.verificationToken.findUnique({ where: { token } });
  if (!record || !record.identifier.startsWith("email-confirm:")) {
    return { ok: false as const, reason: "invalid" as const };
  }
  if (record.expires < new Date()) {
    await db.verificationToken.delete({ where: { token } });
    return { ok: false as const, reason: "expired" as const };
  }

  const userId = record.identifier.slice("email-confirm:".length);
  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { emailVerified: new Date() },
    }),
    db.verificationToken.deleteMany({
      where: { identifier: record.identifier },
    }),
  ]);
  return { ok: true as const, userId };
}
