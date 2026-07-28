import { BRAND } from "@/lib/brand";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

export const CMS_VARIABLES = {
  "brand.name": BRAND.name,
  "brand.domain": BRAND.domain,
  "brand.url": BRAND.url,
  "merchant.name": MERCHANT_LEGAL_INFO.name,
  "merchant.address": MERCHANT_LEGAL_INFO.address,
  "merchant.shortAddress": MERCHANT_LEGAL_INFO.shortAddress,
  "merchant.pib": MERCHANT_LEGAL_INFO.pib,
  "merchant.registrationNumber": MERCHANT_LEGAL_INFO.registrationNumber,
  "merchant.activityCode": MERCHANT_LEGAL_INFO.activityCode,
  "merchant.activityName": MERCHANT_LEGAL_INFO.activityName,
  "merchant.email": MERCHANT_LEGAL_INFO.email,
  "merchant.bankAccount": MERCHANT_LEGAL_INFO.bankAccount,
  "merchant.bankName": MERCHANT_LEGAL_INFO.bankName,
} as const;

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9.]+)\s*\}\}/g;
const HEADING_PATTERN = /^(#{2,3})\s+(.+?)(?:\s+\{#([^}]+)\})?\s*$/;
const ANCHOR_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MARKDOWN_LINK_PATTERN = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const MARKDOWN_REFERENCE_PATTERN = /^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\](?:\([^)]+\)|\[[^\]]*\])/;
const RAW_HTML_PATTERN = /<!--|<\?|<![A-Z]|<\s*\/?\s*[a-z][a-z0-9-]*(?:\s[^>]*)?\s*\/?\s*>/i;

export type CmsMarkdownIssue = {
  code:
    | "empty"
    | "too_long"
    | "raw_html"
    | "image"
    | "h1"
    | "anchor"
    | "duplicate_anchor"
    | "variable"
    | "link";
  message: string;
};

export function expandCmsVariables(value: string) {
  return value.replace(VARIABLE_PATTERN, (source, key: string) => {
    return key in CMS_VARIABLES
      ? CMS_VARIABLES[key as keyof typeof CMS_VARIABLES]
      : source;
  });
}

export function slugifyCmsHeading(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseCmsHeading(value: string) {
  const match = value.match(HEADING_PATTERN);
  if (!match) return null;
  const label = match[2]!.trim();
  const explicitId = match[3]?.trim() || null;
  return {
    depth: match[1]!.length,
    label,
    explicitId,
    id: explicitId ?? slugifyCmsHeading(label),
  };
}

export function isAllowedCmsHref(value: string | null | undefined) {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const href = expandCmsVariables(value).trim();
  if (!href) return false;
  if (href.startsWith("#")) return /^#[a-z0-9][a-z0-9-]*$/i.test(href);
  if (href.startsWith("/")) return !href.startsWith("//");
  try {
    const parsed = new URL(href);
    return ["https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function validateCmsMarkdown(markdown: string): CmsMarkdownIssue[] {
  const issues: CmsMarkdownIssue[] = [];
  const clean = markdown.trim();
  if (!clean) issues.push({ code: "empty", message: "Tekst stranice je obavezan." });
  if (markdown.length > 60_000) {
    issues.push({ code: "too_long", message: "Tekst stranice može imati najviše 60.000 znakova." });
  }
  if (RAW_HTML_PATTERN.test(markdown)) {
    issues.push({ code: "raw_html", message: "Sirov HTML nije dozvoljen." });
  }
  if (MARKDOWN_IMAGE_PATTERN.test(markdown)) {
    issues.push({ code: "image", message: "Markdown slike nisu dozvoljene." });
  }
  if (/^#\s+/m.test(markdown)) {
    issues.push({ code: "h1", message: "Koristite ## ili ###; glavni naslov se unosi iznad editora." });
  }

  const anchors = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    if (/^#{2,3}\s+/.test(line) && line.includes("{#") && !HEADING_PATTERN.test(line)) {
      issues.push({ code: "anchor", message: `Neispravna anchor oznaka: ${line.trim()}` });
      continue;
    }
    const heading = parseCmsHeading(line);
    if (!heading) continue;
    if (!heading.id || !ANCHOR_PATTERN.test(heading.id)) {
      issues.push({ code: "anchor", message: `Neispravan anchor za naslov „${heading.label}”.` });
      continue;
    }
    if (anchors.has(heading.id)) {
      issues.push({ code: "duplicate_anchor", message: `Anchor „${heading.id}” se ponavlja.` });
    }
    anchors.add(heading.id);
  }

  const unknownVariables = new Set<string>();
  for (const match of markdown.matchAll(VARIABLE_PATTERN)) {
    const key = match[1]!;
    if (!(key in CMS_VARIABLES)) unknownVariables.add(key);
  }
  for (const key of unknownVariables) {
    issues.push({ code: "variable", message: `Nepoznata promenljiva „{{${key}}}”.` });
  }

  for (const match of expandCmsVariables(markdown).matchAll(MARKDOWN_LINK_PATTERN)) {
    const href = match[1]!;
    if (!isAllowedCmsHref(href)) {
      issues.push({ code: "link", message: `Link „${href}” nije dozvoljen.` });
    }
  }
  for (const match of expandCmsVariables(markdown).matchAll(MARKDOWN_REFERENCE_PATTERN)) {
    const href = match[1]!;
    if (!isAllowedCmsHref(href)) {
      issues.push({ code: "link", message: `Link „${href}” nije dozvoljen.` });
    }
  }
  return issues;
}

type MarkdownAstNode = {
  type?: string;
  depth?: number;
  value?: string;
  children?: MarkdownAstNode[];
  data?: { hProperties?: Record<string, unknown> };
};

function nodeText(node: MarkdownAstNode): string {
  if (typeof node.value === "string") return node.value;
  return node.children?.map(nodeText).join("") ?? "";
}

function stripExplicitAnchor(node: MarkdownAstNode) {
  if (!node.children?.length) return;
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index]!;
    if (typeof child.value === "string") {
      child.value = child.value.replace(/\s+\{#[^}]+\}\s*$/, "");
      return;
    }
    stripExplicitAnchor(child);
  }
}

export function remarkCmsHeadingIds() {
  return (tree: MarkdownAstNode) => {
    const counts = new Map<string, number>();
    const walk = (node: MarkdownAstNode) => {
      if (node.type === "heading" && (node.depth === 2 || node.depth === 3)) {
        const raw = `${"#".repeat(node.depth)} ${nodeText(node)}`;
        const heading = parseCmsHeading(raw);
        if (heading?.id) {
          const count = (counts.get(heading.id) ?? 0) + 1;
          counts.set(heading.id, count);
          const id = count === 1 ? heading.id : `${heading.id}-${count}`;
          if (heading.explicitId) stripExplicitAnchor(node);
          node.data = {
            ...node.data,
            hProperties: { ...node.data?.hProperties, id },
          };
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
