import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Comments / suggestions form (Phase 3C — item 6).
 * Backed by the `Comment` model; admin moderates via `/admin/comments`.
 */

export const commentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().min(5).max(2000),
});

export type CommentInput = z.infer<typeof commentSchema>;

export async function submitComment(input: CommentInput, userId: string | null) {
  return db.comment.create({
    data: {
      userId,
      name: input.name,
      email: input.email.toLowerCase(),
      subject: input.subject ?? null,
      body: input.body,
    },
    select: { id: true, createdAt: true },
  });
}
