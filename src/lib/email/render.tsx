import "server-only";

import type { ReactElement } from "react";

/**
 * Phase 4D — turn one of the React Email-style templates in
 * `./templates/*` into a transactional HTML document and a plaintext
 * fallback that we can pass to the transport.
 *
 * We use `react-dom/server`'s `renderToStaticMarkup` rather than pulling in
 * `@react-email/render` to avoid an extra dependency; the templates already
 * use only inline-style HTML primitives so static markup is sufficient.
 *
 * The import is deferred via `await import(...)` because Next.js 15 /
 * Turbopack flags static `react-dom/server` imports from app code.
 */

export interface RenderedEmail {
  html: string;
  text: string;
}

export async function renderEmail(node: ReactElement): Promise<RenderedEmail> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const inner = renderToStaticMarkup(node);
  const html = wrap(inner);
  return { html, text: htmlToText(inner) };
}

function wrap(body: string): string {
  return `<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Svet Akcija</title></head><body style="margin:0;background:#FAF7F2;">${body}</body></html>`;
}

/**
 * Best-effort plaintext fallback. We only need readable text — any client
 * that supports `multipart/alternative` will prefer the HTML part.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6]|li|br)>/gi, "\n")
    .replace(/<br\s*\/?>(?!\n)/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
