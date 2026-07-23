const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "blockquote",
]);

const TAG_ALIASES: Record<string, string> = {
  b: "strong",
  i: "em",
  div: "p",
};

function escapeText(value: string) {
  return value
    .replace(/&(?!(?:#\d+|#x[a-f0-9]+|[a-z][a-z0-9]+);)/gi, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainTextToHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeText(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Conservative article-description sanitizer. It reconstructs a small,
 * formatting-only allow-list and drops every attribute, URL and unknown tag.
 */
export function sanitizeRichTextHtml(input: string) {
  const clean = input.trim();
  if (!clean) return "";
  if (!/<[^>]+>/.test(clean)) return plainTextToHtml(clean);

  const tokens = clean.match(/<!--[\s\S]*?-->|<\/?[^>]+>|[^<]+|</g) ?? [];
  const output: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("<!--")) continue;
    if (!token.startsWith("<")) {
      output.push(escapeText(token));
      continue;
    }
    const match = token.match(/^<\s*(\/?)\s*([a-z0-9]+)[^>]*>$/i);
    if (!match) {
      output.push(escapeText(token));
      continue;
    }
    const closing = Boolean(match[1]);
    const rawTag = match[2]!.toLowerCase();
    const tag = TAG_ALIASES[rawTag] ?? rawTag;
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (tag === "br") {
      output.push("<br>");
    } else {
      output.push(`<${closing ? "/" : ""}${tag}>`);
    }
  }
  return output.join("");
}

export const sanitizeRichText = sanitizeRichTextHtml;

export function richTextPlainText(input: string) {
  return input
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/(?:p|div|li|h2|h3|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
