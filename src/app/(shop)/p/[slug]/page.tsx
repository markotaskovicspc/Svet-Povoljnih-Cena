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
import { ProductColorOptions } from "@/components/product/color-options";
import { RecentlyViewedProducts } from "@/components/product/recently-viewed-products";
import { SectionRail } from "@/components/home/section-rail";
import { Reveal } from "@/components/motion/reveal";
import { getProductBySlug, listProducts } from "@/lib/api/catalog";
import { formatDate, formatDimensions, formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deriveImageBadges, effectiveUnitPrice, type Badge } from "@/lib/pricing";
import { herojiMesecaIcon, protectedPricesIcon } from "@/data/campaign-icons";

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
  const cleanDescription = stripHtml(product.description);

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
  const dimensionsLabel = formatDimensions(product.dimensionsCm);

  return (
    <article className="bg-canvas pb-32 md:pb-16">
      {/* Row I — Breadcrumbs */}
      <div className="mx-auto w-full max-w-[var(--container-page)] px-4 pt-6 md:px-6">
        <Breadcrumbs trail={trail} />
      </div>

      {/* Row II/III — Hero info pair */}
      <section className="mx-auto mt-3 grid w-full max-w-[var(--container-page)] gap-3 px-4 md:mt-5 md:grid-cols-[minmax(0,1fr)_minmax(360px,0.86fr)] md:gap-6 md:px-6">
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
        <div className="flex flex-col gap-1.5 md:self-start">
          <header>
            <h1 className="font-display text-xl font-bold text-ink-900 md:text-3xl">
              {product.name}
            </h1>
            {dimensionsLabel ? (
              <p className="mt-1 font-mono text-[11px] tracking-tight text-ink-500 md:text-xs">
                {dimensionsLabel}
              </p>
            ) : null}
            <ProductColorOptions
              product={product}
              selectable
              className="mt-1.5 md:mt-2.5"
              label="Dostupne boje"
            />
          </header>

          {/* Price block — only the effective price is emphasised. */}
          <div className="grid gap-1.5 md:grid-cols-[minmax(0,1fr)_minmax(270px,0.9fr)] md:items-end md:gap-2.5">
            <div>
              <p className="mb-0.5 text-xs font-semibold text-ink-500 md:mb-1">
                {price.kind === "loyalty"
                  ? "MP cena"
                  : price.kind === "sale"
                    ? "Akcijska cena"
                    : "Cena"}
              </p>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {hasReducedPrice ? (
                  <>
                    <span className="text-action text-[30px] leading-none font-black md:text-[34px]">
                      {formatRsd(price.effective)}
                    </span>
                    <span className="text-sm text-ink-500 line-through">
                      {formatRsd(price.full)}
                    </span>
                  </>
                ) : (
                  <span className="text-[28px] leading-none font-black text-ink-900 md:text-[30px]">
                    {formatRsd(price.full)}
                  </span>
                )}
              </div>
              {price.kind === "sale" && product.action?.isPermanent ? (
                <p className="mt-1 text-xs text-ink-500">
                  Trajno niska cena od 01.05.2026.
                </p>
              ) : price.kind === "sale" && product.action?.startsAt && product.action.endsAt ? (
                <p className="mt-1 text-xs text-ink-500">
                  Akcijska cena važi od {formatDate(product.action.startsAt)} do{" "}
                  {formatDate(product.action.endsAt)}
                </p>
              ) : price.kind === "loyalty" ? (
                <p className="mt-1 text-xs text-ink-500">
                  Cena za kupce sa nalogom.
                </p>
              ) : null}
            </div>
            <PdpAddToCart product={product} variant="desktop" />
          </div>

          <ul className="border-border/60 grid grid-cols-2 gap-1 border-t pt-2 text-xs text-ink-700 md:grid-cols-3 md:pt-1.5">
            {benefitChips.slice(0, 6).map((benefit) => (
              <FeatureChip
                key={`${benefit.code}-${benefit.label}`}
                icon={<PictogramIcon code={benefit.code} className="size-3 text-walnut" />}
                label={benefit.label}
              />
            ))}
          </ul>

          <div className="border-border/60 border-t pt-2 md:pt-2.5">
            <div>
              <PdpInfoLinks
                descriptionPreview={cleanDescription}
                sections={{
                  description: product.description,
                  deliveryTerms: product.pdpInfo?.deliveryTerms,
                  declaration: product.pdpInfo?.declaration,
                  assemblyInstructions: product.pdpInfo?.assemblyInstructions,
                  maintenance: product.pdpInfo?.maintenance,
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {materials.length ? (
        <Reveal>
          <section className="mx-auto mt-8 w-full max-w-[var(--container-page)] px-4 md:px-6">
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
          title="Upotpunite kolekciju"
          href={product.collection ? `/kolekcija/${product.collection}` : "/"}
          ctaLabel="Pogledaj kolekciju"
          products={frequentlyBought}
          mobileMinimal
          compactMobileHeader
        />
      ) : null}

      {/* Row XI — Similar products (same group) */}
      {similar.length ? (
        <SectionRail
          title="Možda će vam se svideti"
          href={`/k/${product.categoryPath.map(slugify).join("/")}`}
          ctaLabel="Sve iz kategorije"
          products={similar}
          mobileMinimal
          compactMobileHeader
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
      <PdpStickerBadge
        sticker={herojiMesecaIcon}
        label={badge.label}
        className="h-11 w-14"
      />
    );
  }
  if (badge.key === "permanent") {
    return (
      <PdpStickerBadge
        sticker={protectedPricesIcon}
        label={badge.label}
        className="h-11 w-14"
      />
    );
  }
  if (badge.key === "new") {
    return (
      <PdpStickerBadge
        sticker={{ url: "/brand/promo-stickers/novo.svg", alt: "Novo", width: 600, height: 600 }}
        label={badge.label}
        className="size-11"
      />
    );
  }
  if (badge.key === "limited" || badge.key === "dtz") {
    return (
      <PdpStickerBadge
        sticker={{ url: "/brand/promo-stickers/dtz2.svg", alt: "Dok traju zalihe", width: 1536, height: 1024 }}
        label={badge.label}
        className="h-10 w-16"
      />
    );
  }
  return (
    <span
      className={cn(
        "grid size-11 place-items-center rounded-full text-xs leading-none font-black text-white shadow-soft-1",
        badge.key === "discount" ? "bg-action" : toneClasses[badge.tone],
      )}
    >
      {badge.label}
    </span>
  );
}

function PdpStickerBadge({
  sticker,
  label,
  className,
}: {
  sticker: { url: string; alt?: string; width?: number; height?: number };
  label?: string;
  className?: string;
}) {
  return (
    <span aria-label={label ?? sticker.alt} className={cn("flex items-center justify-center", className)}>
      <Image
        src={sticker.url}
        alt={label ?? sticker.alt ?? ""}
        width={sticker.width ?? 96}
        height={sticker.height ?? 96}
        unoptimized
        className="h-full w-full object-contain"
      />
    </span>
  );
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function FeatureChip({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <li className="bg-surface ring-border/60 flex min-h-9 items-center justify-center gap-1 rounded-md p-1 text-center leading-tight ring-1 shadow-soft-1 md:h-8 md:min-h-0 md:flex-col md:gap-0 md:p-0.5">
      {icon}
      <span className="line-clamp-2 text-xs font-bold md:text-[10px]">{label}</span>
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
