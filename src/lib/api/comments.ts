import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendCommentNotification } from "@/lib/email/comment-notification";

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
  const created = await db.comment.create({
    data: {
      userId,
      name: input.name,
      email: input.email.toLowerCase(),
      subject: input.subject ?? null,
      body: input.body,
    },
    select: { id: true, createdAt: true },
  });

  try {
    const notification = await sendCommentNotification({
      id: created.id,
      name: input.name,
      email: input.email.toLowerCase(),
      subject: input.subject,
      body: input.body,
    });
    if (!notification.ok) {
      console.error(
        `[comments] email notification failed comment=${created.id}: ${notification.error}`,
      );
    }
  } catch (error) {
    console.error(
      `[comments] email notification failed comment=${created.id}`,
      error,
    );
  }

  return created;
}
