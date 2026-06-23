import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

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
