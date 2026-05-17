import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
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
import { RecentlyViewedProducts } from "@/components/product/recently-viewed-products";
import { SectionRail } from "@/components/home/section-rail";
import { Reveal } from "@/components/motion/reveal";
import { getProductBySlug, listProducts } from "@/lib/api/catalog";
import { formatDate, formatDimensions, formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Product Detail Page â€” Phase 1E (12 rows from spec).
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
    .replace(/Å¡/g, "s")
    .replace(/Ä‘/g, "dj")
    .replace(/Ä/g, "c")
    .replace(/Ä‡/g, "c")
    .replace(/Å¾/g, "z")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const HEROJI_MESECA_MARK_SRC = "/brand/heroji-meseca.png";

interface RouteProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Proizvod nije pronaÄ‘en" };
  const price = product.salePrice ?? product.fullPrice;
  return {
    title: `${product.name} â€” ${formatRsd(price)}`,
    description: product.shortDescription ?? product.description.slice(0, 160),
  };
}

export default async function ProductPage({ params }: RouteProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const onSale = !!product.salePrice && product.salePrice < product.fullPrice;
  const sale = product.salePrice ?? product.fullPrice;

  // Row I â€” Breadcrumbs
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

  // Badges (mirror product-card logic, simplified â€” rendered as overlay)
  const overlayBadges = buildOverlayBadges(product);

  // Pictograms â€” fall back to synthesized set if XML hasn't supplied any yet
  const pictograms = product.pictograms.length
    ? product.pictograms
        .map((p) => ({ label: p.label, code: p.code }))
        .filter((p) => !["assembly", "montaza", "montaža"].includes(p.code.toLowerCase()))
    : synthesizedPictograms(product);
  const materials = product.materials;

  return (
    <article className="bg-canvas pb-24 md:pb-16">
      {/* Row I â€” Breadcrumbs */}
      <div className="mx-auto w-full max-w-[var(--container-page)] px-6 pt-6">
        <Breadcrumbs trail={trail} />
      </div>

      {/* Row II/III â€” Hero info pair */}
      <section className="mx-auto mt-6 grid w-full max-w-[var(--container-page)] gap-10 px-6 md:grid-cols-[1.1fr_1fr] md:gap-12">
        {/* Gallery (Row III + IV combined into one stage) */}
        <PdpGallery
          product={product}
          badges={overlayBadges.map((b) =>
            b.kind === "hero" ? (
              <span
                key={b.label}
                aria-label={b.label}
                className="bg-surface/95 ring-border/70 rounded-full px-1.5 py-1 shadow-soft-1 ring-1 backdrop-blur"
              >
                <Image
                  src={HEROJI_MESECA_MARK_SRC}
                  alt={b.label}
                  width={48}
                  height={40}
                  className="h-8 w-10 object-contain"
                />
              </span>
            ) : (
              <span
                key={b.label}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] leading-none font-medium tracking-tight shadow-soft-1",
                  b.cls,
                )}
              >
                {b.label}
              </span>
            ),
          )}
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

          {/* Price block â€” only the active (sale) price is emphasised. */}
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {onSale ? (
                <>
                  <span className="text-action text-3xl font-bold md:text-4xl">
                    {formatRsd(sale)}
                  </span>
                  <span className="text-sm text-ink-500 line-through md:text-base">
                    {formatRsd(product.fullPrice)}
                  </span>
                  {product.discountPct ? (
                    <span className="bg-action/10 text-action ring-action/20 rounded-full px-2 py-0.5 text-xs font-semibold ring-1">
                      âˆ’{product.discountPct}%
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-2xl font-semibold text-ink-900 md:text-3xl">
                  {formatRsd(product.fullPrice)}
                </span>
              )}
            </div>
            {onSale && product.action?.isPermanent ? (
              <p className="mt-1.5 text-xs text-ink-500 md:mt-2 md:text-sm">
                Niska cena pod trajnom zaÅ¡titom od 01.05.2026.
              </p>
            ) : onSale && product.action?.startsAt && product.action.endsAt ? (
              <p className="mt-1.5 text-xs text-ink-500 md:mt-2 md:text-sm">
                Akcijska cena vaÅ¾i od {formatDate(product.action.startsAt)} do{" "}
                {formatDate(product.action.endsAt)}.
              </p>
            ) : null}
          </div>

          {/* Add-to-cart with quantity stepper, moved up directly under price. */}
          <PdpAddToCart product={product} variant="desktop" />

          <ul className="border-border/60 grid grid-cols-2 gap-3 border-t pt-4 text-xs text-ink-700">
            <FeatureChip
              icon={<Truck className="size-3.5" aria-hidden />}
              label={`Isporuka ${product.deliveryDays.min}â€“${product.deliveryDays.max} dana`}
            />
            <FeatureChip
              icon={<ShieldCheck className="size-3.5" aria-hidden />}
              label="2 god. garancije"
            />
            {product.isLimited ? (
              <FeatureChip
                icon={<Sparkles className="size-3.5" aria-hidden />}
                label="OgraniÄena koliÄina"
              />
            ) : null}
          </ul>
        </div>
      </section>

      {/* Row V â€” Pictogram strip */}
      <Reveal>
        <section className="mx-auto mt-8 w-full max-w-[var(--container-page)] px-6 md:mt-16">
          <h2 className="sr-only">Karakteristike</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {pictograms.map((pg) => (
              <li
                key={pg.code}
                className="bg-surface ring-border/60 flex flex-col items-center gap-2 rounded-2xl px-3 py-4 text-center text-xs text-ink-700 shadow-soft-1 ring-1"
              >
                <PictogramIcon code={pg.code} />
                <span className="leading-tight">{pg.label}</span>
              </li>
            ))}
          </ul>
        </section>
      </Reveal>

      {/* Row VI â€” Description */}
      <Reveal>
        <section className="mx-auto mt-8 w-full max-w-[var(--container-page)] px-6 md:mt-16">
          <h2 className="font-display text-2xl text-ink-900 md:text-3xl">
            Opis proizvoda
          </h2>
          <div
            className="mt-4 max-w-prose text-base leading-relaxed text-ink-700"
            // Description is product-supplied; in Phase 4 it comes through the
            // sanitizer that ships with the XML ingest pipeline.
            dangerouslySetInnerHTML={{ __html: product.description }}
          />
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
      <section className="mx-auto mt-8 w-full max-w-[var(--container-page)] px-6 md:mt-16">
        <Link
          href="/uslovi-isporuke"
          className="text-walnut underline underline-offset-4 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-walnut/40"
        >
          Uslovi isporuke i montaže
        </Link>
      </section>

      {/* Row X â€” Frequently bought together (same collection) */}
      {frequentlyBought.length ? (
        <SectionRail
          eyebrow="ÄŒesto kupovano zajedno"
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

      {/* Row XI â€” Similar products (same group) */}
      {similar.length ? (
        <SectionRail
          eyebrow="SliÄni artikli"
          title="MoÅ¾da Ä‡e vam se svideti"
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

interface BadgeOverlay {
  label: string;
  cls: string;
  kind?: "hero";
}

function buildOverlayBadges(p: Product): BadgeOverlay[] {
  const out: BadgeOverlay[] = [];
  if (p.discountPct && p.salePrice) {
    out.push({ label: `-${p.discountPct}%`, cls: "bg-action text-white" });
  }
  if (p.isHero)
    out.push({
      label: "Heroj meseca",
      cls: "bg-sand text-ink-900",
      kind: "hero",
    });
  if (p.action?.name) {
    out.push({
      label: p.action.isPermanent ? "Niske cene" : p.action.name,
      cls: "bg-ink-900 text-canvas",
    });
  }
  if (p.isNew) out.push({ label: "Novo", cls: "bg-olive text-white" });
  if (p.isLimited)
    out.push({ label: "OgraniÄena koliÄina", cls: "bg-warning text-ink-900" });
  if (p.isDtz && p.stock < 15)
    out.push({
      label: "Dok traju zalihe",
      cls: "bg-action/10 text-action ring-1 ring-action/30",
    });
  return out.slice(0, 4);
}

function FeatureChip({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <li className="bg-surface ring-border/60 inline-flex items-center gap-2 rounded-full px-3 py-1.5 ring-1">
      {icon}
      {label}
    </li>
  );
}

interface FallbackPictogram {
  code: string;
  label: string;
}

function synthesizedPictograms(p: Product): FallbackPictogram[] {
  const out: FallbackPictogram[] = [
    { code: "delivery", label: `Isporuka ${p.deliveryDays.min}â€“${p.deliveryDays.max} dana` },
    { code: "warranty", label: "Garancija 2 godine" },
    { code: "quality", label: "Kontrola kvaliteta" },
    { code: "ruler", label: "Precizne dimenzije" },
  ];
  if (p.isHero) {
    out.push({ code: "hero", label: "Heroj meseca" });
  }
  return out;
}

function PictogramIcon({ code }: { code: string }) {
  const cls = "size-7 text-walnut";
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
    default:
      return <Box className={cls} aria-hidden />;
  }
}
