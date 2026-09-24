import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { LOYALTY_CONSENT_VERSION, normalizeLoyaltyEmail } from "./shared";

export const LOYALTY_COOKIE = "spc_guest_loyalty";
export const LOYALTY_SESSION_SECONDS = 30 * 24 * 60 * 60;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const validToken = (token: string) => /^[a-f0-9]{64}$/.test(token);

export async function requestLoyaltyConfirmation(rawEmail: string) {
  const email = normalizeLoyaltyEmail(rawEmail);
  const token = randomBytes(32).toString("hex");
  const identifier = `loyalty-confirm:${email}`;
  await db.$transaction(async (tx) => {
    await tx.guestLoyaltyMembership.upsert({
      where: { email },
      create: { email, consentVersion: LOYALTY_CONSENT_VERSION, consentAt: new Date() },
      update: { consentVersion: LOYALTY_CONSENT_VERSION, consentAt: new Date() },
    });
    await tx.verificationToken.deleteMany({ where: { identifier } });
    await tx.verificationToken.create({ data: {
      identifier, token: digest(token), expires: new Date(Date.now() + 30 * 60_000),
    } });
  });
  return token;
}

export async function confirmLoyalty(token: string) {
  if (!validToken(token)) return null;
  return db.$transaction(async (tx) => {
    const record = await tx.verificationToken.findUnique({ where: { token: digest(token) } });
    if (!record?.identifier.startsWith("loyalty-confirm:") || record.expires <= new Date()) return null;
    const claimed = await tx.verificationToken.deleteMany({ where: {
      token: record.token, expires: { gt: new Date() },
    } });
    if (claimed.count !== 1) return null;
    const email = record.identifier.slice("loyalty-confirm:".length);
    await tx.guestLoyaltyMembership.update({ where: { email }, data: { verifiedAt: new Date() } });
    const session = randomBytes(32).toString("hex");
    await tx.verificationToken.create({ data: {
      identifier: `loyalty-session:${email}`, token: digest(session),
      expires: new Date(Date.now() + LOYALTY_SESSION_SECONDS * 1000),
    } });
    return session;
  });
}

export async function loyaltyMemberForSession(token?: string) {
  if (!token || !validToken(token)) return null;
  const record = await db.verificationToken.findUnique({ where: { token: digest(token) } });
  if (!record?.identifier.startsWith("loyalty-session:") || record.expires <= new Date()) return null;
  const member = await db.guestLoyaltyMembership.findUnique({
    where: { email: record.identifier.slice("loyalty-session:".length) },
  });
  return member?.verifiedAt ? member : null;
}

export async function revokeLoyaltySession(token?: string) {
  if (token && validToken(token)) await db.verificationToken.deleteMany({
    where: { token: digest(token), identifier: { startsWith: "loyalty-session:" } },
  });
}
