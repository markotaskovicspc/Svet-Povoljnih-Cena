import "server-only";

/**
 * Minimal XML → object parser for supplier feeds.
 *
 * Supplier feeds are almost universally a flat list of repeating product
 * nodes with leaf text content, occasional attributes, and CDATA-wrapped
 * descriptions. We deliberately avoid pulling in a heavyweight XML library
 * and ship a focused tokenizer that handles:
 *
 *   - Element start/end tags with attributes (single or double quoted).
 *   - Self-closing tags (`<img src="..." />`).
 *   - CDATA sections (`<![CDATA[...]]>`) — content kept verbatim.
 *   - Standard XML entities (`&amp; &lt; &gt; &quot; &apos; &#NN; &#xNN;`).
 *   - XML / DOCTYPE / processing-instruction prologues (skipped).
 *   - XML comments (`<!-- ... -->`) — skipped.
 *
 * It does NOT attempt to be a fully spec-compliant XML parser (no
 * namespace handling, no DTD validation). For supplier integrations these
 * features are unnecessary and would only widen the attack surface.
 */

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  /** Direct child elements. */
  children: XmlNode[];
  /** Concatenated text content of all immediate text/cdata children. */
  text: string;
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const n = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    if (code.startsWith("#")) {
      const n = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITY_MAP[code] ?? match;
  });
}

/**
 * Parse a complete XML document and return its root element. Throws on
 * malformed input rather than silently returning a half-built tree — the
 * importer treats parse failures as supplier-level errors and records them
 * on the corresponding `ImportRun`.
 */
export function parseXml(source: string): XmlNode {
  const stripped = source
    // Strip BOM if present.
    .replace(/^\uFEFF/, "")
    // Strip XML declaration / processing instructions.
    .replace(/<\?[\s\S]*?\?>/g, "")
    // Strip DOCTYPE.
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    // Strip comments.
    .replace(/<!--[\s\S]*?-->/g, "");

  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let i = 0;
  const len = stripped.length;

  while (i < len) {
    const ch = stripped[i];

    if (ch === "<") {
      // CDATA?
      if (stripped.startsWith("<![CDATA[", i)) {
        const end = stripped.indexOf("]]>", i + 9);
        if (end < 0) throw new Error("Unterminated CDATA section");
        const text = stripped.slice(i + 9, end);
        if (stack.length) stack[stack.length - 1].text += text;
        i = end + 3;
        continue;
      }

      // Closing tag?
      if (stripped[i + 1] === "/") {
        const end = stripped.indexOf(">", i);
        if (end < 0) throw new Error("Unterminated closing tag");
        const tag = stripped.slice(i + 2, end).trim();
        const top = stack.pop();
        if (!top || top.tag !== tag) {
          throw new Error(
            `Mismatched closing tag </${tag}> (expected </${top?.tag ?? "?"}>)`,
          );
        }
        i = end + 1;
        continue;
      }

      // Opening tag (possibly self-closing).
      const end = stripped.indexOf(">", i);
      if (end < 0) throw new Error("Unterminated opening tag");
      const inside = stripped.slice(i + 1, end);
      const selfClosing = inside.endsWith("/");
      const body = selfClosing ? inside.slice(0, -1).trimEnd() : inside;

      // Tag name = first whitespace-delimited token.
      const wsIdx = body.search(/\s/);
      const tagName = (wsIdx === -1 ? body : body.slice(0, wsIdx)).trim();
      const attrsRaw = wsIdx === -1 ? "" : body.slice(wsIdx + 1);
      const attrs: Record<string, string> = {};
      if (attrsRaw) {
        // Match `name="value"` or `name='value'`.
        const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(attrsRaw))) {
          attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
        }
      }

      const node: XmlNode = { tag: tagName, attrs, children: [], text: "" };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else root = node;
      if (!selfClosing) stack.push(node);
      i = end + 1;
      continue;
    }

    // Text node — accumulate until next "<".
    const next = stripped.indexOf("<", i);
    const chunk = next === -1 ? stripped.slice(i) : stripped.slice(i, next);
    if (chunk.trim() && stack.length) {
      stack[stack.length - 1].text += decodeEntities(chunk);
    }
    if (next === -1) break;
    i = next;
  }

  if (stack.length) throw new Error(`Unclosed element <${stack[stack.length - 1].tag}>`);
  if (!root) throw new Error("Empty XML document");
  return root;
}

/**
 * Resolve a path expression against a node, returning matching descendants.
 *
 * Path grammar:
 *   - "/"-separated tag names walk into children.
 *   - "@attr" segment reads an attribute (terminal).
 *   - Trailing "[]" or any segment with multiple matches yields all.
 *
 * Returns string values for attribute terminals, node text for element
 * terminals. Multiple matches accumulate in document order.
 */
export function resolvePath(node: XmlNode, path: string): string[] {
  if (!path) return [];
  const segments = path.split("/").filter(Boolean);
  let current: XmlNode[] = [node];

  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    const isLast = s === segments.length - 1;

    if (segment.startsWith("@")) {
      const attr = segment.slice(1);
      if (!isLast) return [];
      const out: string[] = [];
      for (const n of current) {
        const v = n.attrs[attr];
        if (v !== undefined) out.push(v);
      }
      return out;
    }

    const tag = segment.replace(/\[\]$/, "");
    const next: XmlNode[] = [];
    for (const n of current) {
      for (const c of n.children) if (c.tag === tag) next.push(c);
    }
    current = next;
    if (!current.length) return [];
  }

  return current.map((n) => collapseText(n));
}

/** Concatenate text + descendant text, trimmed. */
function collapseText(node: XmlNode): string {
  let out = node.text;
  for (const c of node.children) out += collapseText(c);
  return out.trim();
}

/** Walk the document and collect all element nodes whose tag matches. */
export function findAll(node: XmlNode, tag: string): XmlNode[] {
  const out: XmlNode[] = [];
  const stack: XmlNode[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    for (const c of n.children) {
      if (c.tag === tag) out.push(c);
      if (c.children.length) stack.push(c);
    }
  }
  return out;
}
