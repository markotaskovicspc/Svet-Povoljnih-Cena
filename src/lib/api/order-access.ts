import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

const TOKEN_BYTES = 32;

export function createOrderAccessToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashOrderAccessToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function verifyOrderAccessToken(args: {
  token: string | null | undefined;
  tokenHash: string | null | undefined;
}) {
  if (!args.token || !args.tokenHash) return false;
  const expected = Buffer.from(args.tokenHash);
  const actual = Buffer.from(hashOrderAccessToken(args.token));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function readOrderAccessToken(req: Request) {
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token")?.trim();
  if (queryToken) return queryToken;

  const headerToken = req.headers.get("x-order-access-token")?.trim();
  if (headerToken) return headerToken;

  const auth = req.headers.get("authorization")?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export async function canAccessOrder(args: {
  order: {
    userId: string | null;
    publicAccessTokenHash: string | null;
  };
  token?: string | null;
}) {
  const user = await getCurrentUser();
  if (user?.userType === "customer" && args.order.userId === user.id) {
    return true;
  }

  return verifyOrderAccessToken({
    token: args.token,
    tokenHash: args.order.publicAccessTokenHash,
  });
}

export async function rotateOrderAccessToken(
  orderIdOrNumber: string,
  tx?: Prisma.TransactionClient,
) {
  const token = createOrderAccessToken();
  const client = tx ?? db;
  const data = {
    publicAccessTokenHash: hashOrderAccessToken(token),
    publicAccessTokenCreatedAt: new Date(),
  };
  if (orderIdOrNumber.startsWith("SPC-")) {
    await client.order.update({ where: { number: orderIdOrNumber }, data });
  } else {
    await client.order.update({ where: { id: orderIdOrNumber }, data });
  }
  return token;
}
