import "server-only";
import { db } from "@/lib/db";

export const LEGACY_LOGIN_MERGE_WINDOW_MS = 30_000;

export function isWithinLegacyLoginMergeWindow(
  lastLoginAt: Date | null,
  now = new Date(),
): boolean {
  if (!lastLoginAt) return false;
  const elapsed = now.getTime() - lastLoginAt.getTime();
  return elapsed >= 0 && elapsed <= LEGACY_LOGIN_MERGE_WINDOW_MS;
}

export async function shouldMergeLegacyCommerceAfterLogin(
  userId: string,
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { lastLoginAt: true },
  });
  return isWithinLegacyLoginMergeWindow(user?.lastLoginAt ?? null);
}
