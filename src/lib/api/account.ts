import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Account / profile management (Phase 3C — item 4).
 *
 * Server actions consumed by `src/app/(account)/nalog/...` forms. All exports
 * call `requireUser()` at the page boundary; this module trusts that the
 * `userId` argument is already authenticated.
 */

export const profileSchema = z.object({
  firstName: z.string().trim().min(2).max(80).optional(),
  lastName: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(8).max(32).optional(),
  isBusiness: z.boolean().optional(),
  companyName: z.string().trim().max(120).optional(),
  pib: z.string().trim().regex(/^\d{9}$/).optional(),
  language: z.enum(["sr-Latn", "sr-Cyrl"]).optional(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

export async function getProfile(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      isBusiness: true,
      companyName: true,
      pib: true,
      language: true,
      image: true,
      createdAt: true,
      marketingConsent: true,
    },
  });
}

export async function updateProfile(userId: string, input: ProfileInput) {
  const data = profileSchema.parse(input);
  const name =
    data.firstName || data.lastName
      ? [data.firstName, data.lastName].filter(Boolean).join(" ")
      : undefined;
  return db.user.update({
    where: { id: userId },
    data: {
      ...data,
      ...(name ? { name } : {}),
    },
  });
}
