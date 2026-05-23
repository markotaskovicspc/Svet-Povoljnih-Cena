import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import {
  Award,
  Box,
  Check,
  Hammer,
  Leaf,
  Ruler,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import type { Product } from "@/types";
import { Breadcrumbs, type Crumb } from "@/components/layout/breadcrumbs";
import { PdpGallery } from "@/components/product/pdp-gallery";
import { PdpAddToCart } from "@/components/product/pdp-add-to-cart";
import { PdpInfoLinks } from "@/components/product/pdp-info-links";
import { RecentlyViewedProducts } from "@/components/product/recently-viewed-products";
import { SectionRail } from "@/components/home/section-rail";
import { Reveal } from "@/components/motion/reveal";
import { getProductBySlug, listProducts } from "@/lib/api/catalog";
import { formatDate, formatDimensions, formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deriveImageBadges, effectiveUnitPrice, type Badge } from "@/lib/pricing";

/**
 * Product Detail Page — Phase 1E (12 rows from spec).
 *
 * Server component (SEO-critical). Interactive bits (gallery, add-to-cart,
 * delivery picker) are client islands. Missing or inactive products resolve
 * through getProductBySlug() as null. Stock changes should not turn an existing
 * active PDP into an accidental 404; the buy controls handle out-of-stock UI.
 */

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const HEROJI_MESECA_MARK_SRC = "/brand/heroji-meseca.png";

interface RouteProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Proizvod nije pronađen" };
  const price = effectiveUnitPrice(product);
  return {
    title: `${product.name} — ${formatRsd(price.effective)}`,
    description: product.shortDescription ?? product.description.slice(0, 160),
  };
}

export default async function ProductPage({ params }: RouteProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const price = effectiveUnitPrice(product);
  const hasReducedPrice = price.effective < price.full;

  // Row I — Breadcrumbs
  const trail: Crumb[] = [
    ...product.categoryPath.map((label, i, arr) => ({
      label,
      href:
        i < arr.length
          ? `/k/${arr.slice(0, i + 1).map(slugify).join("/")}`
          : undefined,
    })),
    { label: product.sku },
  ];

  // Related sets
  const [frequentlyBought, similar] = await Promise.all([
    product.collection
      ? listProducts({
          collectionSlug: product.collection,
          excludeSku: product.sku,
          limit: 8,
        }).then((r) => r.items).catch(() => [])
      : Promise.resolve([]),
    product.group
      ? listProducts({ groupSlug: product.group, excludeSku: product.sku, limit: 8 })
          .then((r) => r.items)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const overlayBadges = deriveImageBadges(product);
  const summaryDescription = firstSentences(stripHtml(product.description), 3);

  // Pictograms — fall back to synthesized set if XML hasn't supplied any yet
  const pictograms = product.pictograms.length
    ? product.pictograms
        .map((p) => ({ label: p.label, code: p.code }))
        .filter((p) => !["assembly", "montaza", "montaža"].includes(p.code.toLowerCase()))
    : synthesizedPictograms(product);
  const benefitChips = product.isLimited
    ? [...pictograms, { code: "limited", label: "Dok traju zalihe" }]
    : pictograms;
  const materials = product.materials;

  return (
    <article className="bg-canvas pb-24 md:pb-16">
      {/* Row I — Breadcrumbs */}
      <div className="mx-auto w-full max-w-[var(--container-page)] px-6 pt-6">
        <Breadcrumbs trail={trail} />
      </div>

      {/* Row II/III — Hero info pair */}
      <section className="mx-auto mt-6 grid w-full max-w-[var(--container-page)] gap-10 px-6 md:grid-cols-[1.1fr_1fr] md:gap-12">
        {/* Gallery (Row III + IV combined into one stage) */}
        <PdpGallery
          product={product}
          badges={
            <>
              {overlayBadges.topLeft.map((b) => (
                <PdpBadge key={b.key} badge={b} />
              ))}
              {overlayBadges.bottomLeft.map((b) => (
                <PdpBadge key={b.key} badge={b} />
              ))}
            </>
          }
        />

        {/* Right column: identity + price + sticky CTA */}
        <div className="flex flex-col gap-4 md:gap-6">
          <header>
            <p className="font-mono text-[10px] tracking-[0.18em] text-walnut uppercase md:text-[11px]">
              {product.categoryPath.join(" / ")}
            </p>
            <h1 className="font-display mt-1.5 text-2xl text-ink-900 md:mt-2 md:text-4xl">
              {product.name}
            </h1>
            <p className="mt-2 font-mono text-xs tracking-tight text-ink-500 md:text-sm">
              {formatDimensions(product.dimensionsCm)}
            </p>
          </header>

          {/* Price block — only the effective price is emphasised. */}
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {hasReducedPrice ? (
                <>
                  <span className="text-action text-3xl font-bold md:text-4xl">
                    {formatRsd(price.effective)}
                  </span>
                  <span className="text-sm text-ink-500 line-through md:text-base">
                    {formatRsd(price.full)}
                  </span>
                </>
              ) : (
                <span className="text-2xl font-semibold text-ink-900 md:text-3xl">
                  {formatRsd(price.full)}
                </span>
              )}
            </div>
            {price.kind === "sale" && product.action?.isPermanent ? (
              <p className="mt-1.5 text-xs text-ink-500 md:mt-2 md:text-sm">
                Trajno niska cena od 01.05.2026.
              </p>
            ) : price.kind === "sale" && product.action?.startsAt && product.action.endsAt ? (
              <p className="mt-1.5 text-xs text-ink-500 md:mt-2 md:text-sm">
                Akcijska cena važi od {formatDate(product.action.startsAt)} do{" "}
                {formatDate(product.action.endsAt)}.
              </p>
            ) : price.kind === "loyalty" ? (
              <p className="mt-1.5 text-xs text-ink-500 md:mt-2 md:text-sm">
                Loyalty cena za kupce sa nalogom.
              </p>
            ) : null}
          </div>

          {/* Add-to-cart with quantity stepper, moved up directly under price. */}
          <PdpAddToCart product={product} variant="desktop" />

          <ul className="border-border/60 flex flex-wrap gap-2 border-t pt-4 text-xs text-ink-700">
            {benefitChips.map((benefit) => (
              <FeatureChip
                key={`${benefit.code}-${benefit.label}`}
                icon={<PictogramIcon code={benefit.code} className="size-3.5 text-walnut" />}
                label={benefit.label}
              />
            ))}
          </ul>
        </div>
      </section>

      {/* Row VI — Description */}
      <Reveal>
        <section className="mx-auto mt-8 w-full max-w-[var(--container-page)] px-6 md:mt-16">
          <div className="grid gap-8 md:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] md:items-start md:gap-12">
            <div>
              <h2 className="font-display text-2xl text-ink-900 md:text-3xl">
                Opis proizvoda
              </h2>
              <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-700">
                {summaryDescription}
              </p>
            </div>
            <PdpInfoLinks
              sections={{
                deliveryTerms: product.pdpInfo?.deliveryTerms,
                declaration: product.pdpInfo?.declaration,
                assemblyInstructions: product.pdpInfo?.assemblyInstructions,
                maintenance: product.pdpInfo?.maintenance,
              }}
            />
          </div>
        </section>
      </Reveal>

      {materials.length ? (
        <Reveal>
          <section className="mx-auto mt-8 w-full max-w-[var(--container-page)] px-6 md:mt-16">
            <h2 className="font-display text-2xl text-ink-900 md:text-3xl">
              Materijali
            </h2>
            <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {materials.map((m) => (
                <li
                  key={m.id}
                  className="bg-surface ring-border/60 overflow-hidden rounded-2xl ring-1"
                >
                  <div className="bg-muted-bg relative aspect-square">
                    {m.imageUrl ? (
                      <Image
                        src={m.imageUrl}
                        alt={m.label}
                        fill
                        sizes="(min-width: 768px) 25vw, 50vw"
                        className="object-cover"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-ink-300">
                        <Leaf className="size-6" aria-hidden />
                      </div>
                    )}
                  </div>
                  <p className="px-3 py-2 text-sm text-ink-700">{m.label}</p>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>
      ) : null}
      {/* Row X — Frequently bought together (same collection) */}
      {frequentlyBought.length ? (
        <SectionRail
          eyebrow="Često kupovano zajedno"
          title="Upotpunite kolekciju"
          href={
            product.collection
              ? `/k/${slugify(product.categoryPath[0] ?? "")}`
              : "/"
          }
          ctaLabel="Pogledaj kolekciju"
          products={frequentlyBought}
        />
      ) : null}

      {/* Row XI — Similar products (same group) */}
      {similar.length ? (
        <SectionRail
          eyebrow="Slični artikli"
          title="Možda će vam se svideti"
          href={`/k/${product.categoryPath.map(slugify).join("/")}`}
          ctaLabel="Sve iz kategorije"
          products={similar}
        />
      ) : null}

      <RecentlyViewedProducts product={product} />

      {/* Sticky add-to-cart (mobile) */}
      <PdpAddToCart product={product} variant="mobile" />
    </article>
  );
}

/* ---------- helpers ---------- */

const toneClasses = {
  action: "bg-action text-white",
  gold: "bg-sand text-ink-900",
  olive: "bg-olive text-white",
  amber: "bg-warning text-ink-900",
  red: "bg-action/10 text-action ring-1 ring-action/30",
  ink: "bg-ink-900 text-canvas",
  protected: "bg-brand-blue text-white",
};

function PdpBadge({ badge }: { badge: Badge }) {
  if (badge.key === "hero") {
    return (
      <span
        aria-label={badge.label}
        className="bg-surface/95 ring-border/70 rounded-full px-1.5 py-1 shadow-soft-1 ring-1 backdrop-blur"
      >
        <Image
          src={HEROJI_MESECA_MARK_SRC}
          alt={badge.label}
          width={48}
          height={40}
          className="h-8 w-10 object-contain"
        />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] leading-none font-medium tracking-tight shadow-soft-1",
        toneClasses[badge.tone],
      )}
    >
      {badge.label}
    </span>
  );
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function firstSentences(value: string, count: number) {
  const sentences = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [value];
  return sentences.slice(0, count).join(" ").trim();
}

function FeatureChip({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <li className="bg-surface ring-border/60 inline-flex min-h-8 items-center gap-2 rounded-full px-3 py-1.5 leading-tight ring-1 shadow-soft-1">
      {icon}
      <span>{label}</span>
    </li>
  );
}

interface FallbackPictogram {
  code: string;
  label: string;
}

function synthesizedPictograms(p: Product): FallbackPictogram[] {
  const out: FallbackPictogram[] = [
    { code: "delivery", label: `Isporuka ${p.deliveryDays.min}–${p.deliveryDays.max} dana` },
    { code: "warranty", label: "Garancija 2 godine" },
    { code: "quality", label: "Kontrola kvaliteta" },
    { code: "ruler", label: "Precizne dimenzije" },
  ];
  if (p.isHero) {
    out.push({ code: "hero", label: "Heroj meseca" });
  }
  return out;
}

function PictogramIcon({
  code,
  className = "size-7 text-walnut",
}: {
  code: string;
  className?: string;
}) {
  const cls = className;
  switch (code) {
    case "delivery":
      return <Truck className={cls} aria-hidden />;
    case "warranty":
      return <ShieldCheck className={cls} aria-hidden />;
    case "assembly":
      return <Hammer className={cls} aria-hidden />;
    case "ruler":
      return <Ruler className={cls} aria-hidden />;
    case "hero":
      return <Award className={cls} aria-hidden />;
    case "quality":
      return <Check className={cls} aria-hidden />;
    case "limited":
      return <Sparkles className={cls} aria-hidden />;
    default:
      return <Box className={cls} aria-hidden />;
  }
}
