import "server-only";

import { getEmailConfig } from "./config";
import { trackedDispatch } from "./tracking";

type CommentNotification = {
  id: string;
  name: string;
  email: string;
  subject?: string | null;
  body: string;
};

export async function sendCommentNotification(comment: CommentNotification) {
  const cfg = getEmailConfig();
  const topic = comment.subject?.trim() || "Bez teme";
  const adminUrl = `${cfg.baseUrl.replace(/\/$/, "")}/admin/komentari`;
  const bodyHtml = escapeHtml(comment.body).replaceAll("\n", "<br />");

  return trackedDispatch({
    kind: "comment_notification",
    to: cfg.commentsNotificationTo,
    replyTo: comment.email,
    subject: `Nova poruka sa sajta — ${topic}`,
    html: `<!doctype html><html lang="sr-Latn"><body style="margin:0;background:#f2f6f8;padding:24px;font-family:Arial,sans-serif;color:#1a1714;"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;"><h1 style="font-size:24px;margin:0 0 20px;">Nova poruka sa sajta</h1><p><strong>Ime:</strong> ${escapeHtml(comment.name)}<br /><strong>E-pošta:</strong> ${escapeHtml(comment.email)}<br /><strong>Tema:</strong> ${escapeHtml(topic)}</p><div style="margin:20px 0;padding:18px;background:#f8f6f3;border-radius:10px;line-height:1.6;">${bodyHtml}</div><p style="margin:0;"><a href="${escapeHtml(adminUrl)}">Otvori poruku u admin panelu</a></p></div></body></html>`,
    text: `Nova poruka sa sajta\n\nIme: ${comment.name}\nE-pošta: ${comment.email}\nTema: ${topic}\n\n${comment.body}\n\nAdmin: ${adminUrl}`,
    tags: { kind: "comment_notification" },
    metadata: { commentId: comment.id },
    idempotencyKey: `comment-notification:${comment.id}`,
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
