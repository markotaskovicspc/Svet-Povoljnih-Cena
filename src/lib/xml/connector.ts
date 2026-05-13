import "server-only";

import { findAll, parseXml, resolvePath, type XmlNode } from "./parser";
import type {
  FeedItem,
  FeedMaterial,
  FeedMedia,
  FeedPictogram,
  SupplierConnector,
  SupplierConfig,
  SupplierFeedMapping,
} from "./types";

/**
 * Apply a per-supplier `SupplierFeedMapping` to a parsed XML root and emit
 * canonical `FeedItem[]`. Lives separately from the connector so the same
 * mapping can be applied to any source (HTTP, file, fixture).
 */
export function mapXmlToFeed(
  root: XmlNode,
  mapping: SupplierFeedMapping,
): FeedItem[] {
  const items = findAll(root, mapping.itemPath);
  const out: FeedItem[] = [];
  for (const node of items) {
    const item = mapOne(node, mapping);
    if (item) out.push(item);
  }
  return out;
}

function first(node: XmlNode, path?: string): string | undefined {
  if (!path) return undefined;
  const v = resolvePath(node, path);
  return v.length ? v[0] : undefined;
}

function many(node: XmlNode, path?: string): string[] {
  if (!path) return [];
  return resolvePath(node, path);
}

function toNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const cleaned = v.replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/\./g, (m, _o, s) => {
    // Treat dots as thousands separators only when there is also a comma decimal.
    return s.includes(",") ? "" : ".";
  });
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function toInt(v: string | undefined): number | undefined {
  const n = toNumber(v);
  if (n === undefined) return undefined;
  return Math.trunc(n);
}

function toBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "da", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "ne", "n", "off", ""].includes(s)) return false;
  return undefined;
}

function toDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[đ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function mapOne(node: XmlNode, m: SupplierFeedMapping): FeedItem | null {
  const externalId = first(node, m.externalId);
  if (!externalId) return null;
  const sku = first(node, m.sku) ?? externalId;
  const name = first(node, m.name);
  if (!name) return null;
  const fullPrice = toNumber(first(node, m.fullPrice));
  if (fullPrice === undefined) return null;

  const stock = toInt(first(node, m.stock)) ?? 0;
  const salePrice = toNumber(first(node, m.salePrice));
  const discountPct = toInt(first(node, m.discountPct));

  const categoryRaw = first(node, m.categoryPath);
  const categoryPath = categoryRaw
    ? categoryRaw
        .split(m.categorySeparator ?? "/")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const action = (() => {
    const slug = first(node, m.actionSlug);
    const aname = first(node, m.actionName);
    const startsAt = toDate(first(node, m.actionStartsAt));
    const endsAt = toDate(first(node, m.actionEndsAt));
    if (!slug || !aname || !startsAt || !endsAt) return undefined;
    return {
      slug,
      name: aname,
      startsAt,
      endsAt,
      isHero: toBool(first(node, m.actionIsHero)) ?? false,
    };
  })();

  const media: FeedMedia[] = [];
  many(node, m.imagesPath).forEach((url, idx) => {
    if (url) media.push({ url, kind: "image", order: idx });
  });
  const video = first(node, m.videoPath);
  if (video) media.push({ url: video, kind: "video", order: media.length });
  const video3d = first(node, m.video3dPath);
  if (video3d) media.push({ url: video3d, kind: "video3d", order: media.length });

  const pictograms: FeedPictogram[] = many(node, m.pictogramCodesPath)
    .filter(Boolean)
    .map((code) => ({ code: code.trim() }));

  const materials: FeedMaterial[] = many(node, m.materialSlugsPath)
    .filter(Boolean)
    .map((label) => ({ slug: slugify(label), label }));

  const item: FeedItem = {
    externalId,
    sku,
    slug: first(node, m.slug) || slugify(name),
    name,
    description: first(node, m.description),
    shortDescription: first(node, m.shortDescription),
    categoryPath,
    groupSlug: first(node, m.groupSlug),
    collectionSlug: first(node, m.collectionSlug),
    widthCm: toNumber(first(node, m.widthCm)),
    depthCm: toNumber(first(node, m.depthCm)),
    heightCm: toNumber(first(node, m.heightCm)),
    fullPrice,
    salePrice: salePrice ?? null,
    discountPct: discountPct ?? null,
    action: action ?? null,
    isHero: toBool(first(node, m.isHero)),
    isNew: toBool(first(node, m.isNew)),
    newUntil: toDate(first(node, m.newUntil)) ?? null,
    isLimited: toBool(first(node, m.isLimited)),
    isDtz: toBool(first(node, m.isDtz)),
    stock,
    incomingStock: toInt(first(node, m.incomingStock)),
    supplierStock: toInt(first(node, m.supplierStock)),
    deliveryDaysMin: toInt(first(node, m.deliveryDaysMin)),
    deliveryDaysMax: toInt(first(node, m.deliveryDaysMax)),
    allowsAssembly: toBool(first(node, m.allowsAssembly)),
    media: media.length ? media : undefined,
    pictograms: pictograms.length ? pictograms : undefined,
    materials: materials.length ? materials : undefined,
  };

  return item;
}

/**
 * Default HTTP + XML connector. Streams the feed via `fetch`, supports
 * optional HTTP Basic auth (the only auth scheme any of our suppliers
 * publish), and reuses `parseXml` + `mapXmlToFeed` for the rest.
 */
export class HttpXmlConnector implements SupplierConnector {
  constructor(private readonly cfg: SupplierConfig) {}

  async fetchRaw(): Promise<string> {
    const headers: Record<string, string> = {
      // Some PHP feed endpoints serve HTML if we omit Accept.
      Accept: "application/xml, text/xml, */*;q=0.5",
      "User-Agent": "SvetAkcija-FeedImporter/1.0",
    };
    if (this.cfg.authUser) {
      const token = Buffer.from(
        `${this.cfg.authUser}:${this.cfg.authPass ?? ""}`,
      ).toString("base64");
      headers.Authorization = `Basic ${token}`;
    }
    const res = await fetch(this.cfg.feedUrl, {
      headers,
      // Feeds are always fresh; never let Next cache them.
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `Supplier feed HTTP ${res.status} ${res.statusText} (${this.cfg.feedUrl})`,
      );
    }
    return await res.text();
  }

  parse(raw: string): FeedItem[] {
    const root = parseXml(raw);
    return mapXmlToFeed(root, this.cfg.mapping);
  }
}

/**
 * Convenience: pick the right connector for a supplier. Today only HTTP +
 * XML is implemented; future suppliers (CSV via FTP, JSON, etc.) plug in
 * here without touching the importer.
 */
export function connectorFor(cfg: SupplierConfig): SupplierConnector {
  return new HttpXmlConnector(cfg);
}
