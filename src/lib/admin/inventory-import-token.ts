import { createHmac, timingSafeEqual } from "node:crypto";

type InventoryImportTokenPayload = {
  adminId: string;
  fileHash: string;
  stateHash: string;
  expiresAt: number;
};

function signingSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET je obavezan za bezbednu potvrdu lager importa.");
  }
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function createInventoryImportToken(
  input: Omit<InventoryImportTokenPayload, "expiresAt">,
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({ ...input, expiresAt: now + 15 * 60_000 }),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyInventoryImportToken(
  token: string,
  expected: Omit<InventoryImportTokenPayload, "expiresAt">,
  now = Date.now(),
) {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return false;
  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const calculated = Buffer.from(expectedSignature);
  if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) {
    return false;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<InventoryImportTokenPayload>;
    return (
      decoded.adminId === expected.adminId &&
      decoded.fileHash === expected.fileHash &&
      decoded.stateHash === expected.stateHash &&
      typeof decoded.expiresAt === "number" &&
      decoded.expiresAt >= now
    );
  } catch {
    return false;
  }
}
