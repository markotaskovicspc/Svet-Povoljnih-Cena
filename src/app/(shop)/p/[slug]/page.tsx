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
import { mockProducts } from "@/data/products";
import type { Product } from "@/types";
import { Breadcrumbs, type Crumb } from "@/components/layout/breadcrumbs";
import { PdpGallery } from "@/components/product/pdp-gallery";
import { PdpAddToCart } from "@/components/product/pdp-add-to-cart";
import { PdpDelivery } from "@/components/product/pdp-delivery";
import { SectionRail } from "@/components/home/section-rail";
import { Reveal } from "@/components/motion/reveal";
import { formatDate, formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Product Detail Page — Phase 1E (12 rows from spec).
 *
 * Server component (SEO-critical). Interactive bits (gallery, add-to-cart,
 * delivery picker) are client islands. If the product is fully unavailable
 * (stock=0 && incomingStock=0) the page is hidden — the spec asks for HTTP
 * 410 here; App Router pages can only signal 404 via notFound(), so we use
 * that for now and revisit when middleware / route handlers wire in real
 * inventory in Phase 4.
 */

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/š/g, "s")
    .replace(/đ/g, "dj")
    .replace(/č/g, "c")
    .replace(/ć/g, "c")
    .replace(/ž/g, "z")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

interface RouteProps {
  params: Promise<{ slug: string }>;
}

function getProduct(slug: string): Product | undefined {
  return mockProducts.find((p) => p.slug === slug);
}

export async function generateStaticParams() {
  return mockProducts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) return { title: "Proizvod nije pronađen" };
  const price = product.salePrice ?? product.fullPrice;
  return {
    title: `${product.name} — ${formatRsd(price)}`,
    description: product.shortDescription ?? product.description.slice(0, 160),
  };
}

export default async function ProductPage({ params }: RouteProps) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) notFound();

  // Spec: hide product when fully unavailable (return 410). See header note.
  if (product.stock === 0 && product.incomingStock === 0) notFound();

  const onSale = !!product.salePrice && product.salePrice < product.fullPrice;
  const sale = product.salePrice ?? product.fullPrice;

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
  const frequentlyBought = mockProducts.filter(
    (p) =>
      p.sku !== product.sku &&
      product.collection &&
      p.collection === product.collection,
  );
  const similar = mockProducts.filter(
    (p) => p.sku !== product.sku && p.group === product.group,
  );

  // Badges (mirror product-card logic, simplified — rendered as overlay)
  const overlayBadges = buildOverlayBadges(product);

  // Pictograms — fall back to synthesized set if XML hasn't supplied any yet
  const pictograms = product.pictograms.length
    ? product.pictograms.map((p) => ({ label: p.label, code: p.code }))
    : synthesizedPictograms(product);

  // Materials — show only when present (Phase 4 fills these from XML)
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
          badges={overlayBadges.map((b) => (
            <span
              key={b.label}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] leading-none font-medium tracking-tight shadow-soft-1",
                b.cls,
              )}
            >
              {b.label}
            </span>
          ))}
        />

        {/* Right column: identity + price + sticky CTA */}
        <div className="flex flex-col gap-6">
          <header>
            <p className="font-mono text-[11px] tracking-[0.18em] text-walnut uppercase">
              {product.categoryPath.join(" / ")}
            </p>
            <h1 className="font-display mt-2 text-3xl text-ink-900 md:text-4xl">
              {product.name}
            </h1>
            <p className="mt-1 font-mono text-xs text-ink-500">SKU {product.sku}</p>
            {product.shortDescription ? (
              <p className="mt-4 max-w-prose text-base text-ink-700">
                {product.shortDescription}
              </p>
            ) : null}
          </header>

          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {onSale ? (
                <>
                  <span className="text-action text-3xl font-semibold">
                    {formatRsd(sale)}
                  </span>
                  <span className="text-base text-ink-500 line-through">
                    {formatRsd(product.fullPrice)}
                  </span>
                  {product.discountPct ? (
                    <span className="bg-action/10 text-action ring-action/20 rounded-full px-2 py-0.5 text-xs font-semibold ring-1">
                      −{product.discountPct}%
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-3xl font-semibold text-ink-900">
                  {formatRsd(product.fullPrice)}
                </span>
              )}
            </div>
            {onSale && product.action?.startsAt && product.action.endsAt ? (
              <p className="mt-2 text-sm text-ink-500">
                Akcijska cena važi od {formatDate(product.action.startsAt)} do{" "}
                {formatDate(product.action.endsAt)}.
              </p>
            ) : null}
          </div>

          <PdpAddToCart product={product} variant="desktop" />

          <ul className="border-border/60 grid grid-cols-2 gap-3 border-t pt-4 text-xs text-ink-700">
            <FeatureChip
              icon={<Truck className="size-3.5" aria-hidden />}
              label={`Isporuka ${product.deliveryDays.min}–${product.deliveryDays.max} dana`}
            />
            <FeatureChip
              icon={<ShieldCheck className="size-3.5" aria-hidden />}
              label="2 god. garancije"
            />
            {product.allowsAssembly ? (
              <FeatureChip
                icon={<Hammer className="size-3.5" aria-hidden />}
                label="Montaža dostupna"
              />
            ) : null}
            {product.isLimited ? (
              <FeatureChip
                icon={<Sparkles className="size-3.5" aria-hidden />}
                label="Ograničena količina"
              />
            ) : null}
          </ul>
        </div>
      </section>

      {/* Row V — Pictogram strip */}
      <Reveal>
        <section className="mx-auto mt-16 w-full max-w-[var(--container-page)] px-6">
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

      {/* Row VI — Description */}
      <Reveal>
        <section className="mx-auto mt-16 w-full max-w-[var(--container-page)] px-6">
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

      {/* Row VII — Dimensions */}
      <Reveal>
        <section className="mx-auto mt-16 w-full max-w-[var(--container-page)] px-6">
          <h2 className="font-display text-2xl text-ink-900 md:text-3xl">
            Dimenzije
          </h2>
          <div className="mt-6 grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-center">
            <DimensionsTable dims={product.dimensionsCm} />
            <DimensionsDiagram dims={product.dimensionsCm} />
          </div>
        </section>
      </Reveal>

      {/* Row VIII — Materials */}
      {materials.length ? (
        <Reveal>
          <section className="mx-auto mt-16 w-full max-w-[var(--container-page)] px-6">
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

      {/* Row IX — Delivery & assembly */}
      <Reveal>
        <section className="mx-auto mt-16 w-full max-w-[var(--container-page)] px-6">
          <h2 className="font-display text-2xl text-ink-900 md:text-3xl">
            Isporuka i montaža
          </h2>
          <div className="mt-6">
            <PdpDelivery product={product} />
          </div>
        </section>
      </Reveal>

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

      {/* Row XII — Sticky add-to-cart (mobile) */}
      <PdpAddToCart product={product} variant="mobile" />
    </article>
  );
}

/* ---------- helpers ---------- */

interface BadgeOverlay {
  label: string;
  cls: string;
}

function buildOverlayBadges(p: Product): BadgeOverlay[] {
  const out: BadgeOverlay[] = [];
  if (p.discountPct && p.salePrice) {
    out.push({ label: `-${p.discountPct}%`, cls: "bg-action text-white" });
  }
  if (p.isHero) out.push({ label: "Heroj akcije", cls: "bg-sand text-ink-900" });
  if (p.action?.name) out.push({ label: p.action.name, cls: "bg-ink-900 text-canvas" });
  if (p.isNew) out.push({ label: "Novo", cls: "bg-olive text-white" });
  if (p.isLimited)
    out.push({ label: "Ograničena količina", cls: "bg-warning text-ink-900" });
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

function DimensionsTable({ dims }: { dims: Product["dimensionsCm"] }) {
  return (
    <table className="bg-surface ring-border/60 w-full overflow-hidden rounded-2xl text-sm ring-1">
      <tbody>
        <DimRow label="Širina (Š)" value={`${dims.w} cm`} />
        <DimRow label="Dubina (D)" value={`${dims.d} cm`} />
        <DimRow label="Visina (V)" value={`${dims.h} cm`} />
      </tbody>
    </table>
  );
}

function DimRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-border/60 border-b last:border-0">
      <th
        scope="row"
        className="text-left text-xs font-medium tracking-wide text-ink-500 uppercase px-4 py-3"
      >
        {label}
      </th>
      <td className="px-4 py-3 text-right font-mono text-ink-900">{value}</td>
    </tr>
  );
}

function DimensionsDiagram({ dims }: { dims: Product["dimensionsCm"] }) {
  // Simple isometric box outline. Width/height of the SVG are unitless;
  // ratios reflect the proportions of the product so the sketch looks "right".
  const max = Math.max(dims.w, dims.d, dims.h, 1);
  const w = (dims.w / max) * 160;
  const d = (dims.d / max) * 90;
  const h = (dims.h / max) * 200;

  const ox = 40; // origin x for front face bottom-left
  const oy = 240; // origin y for front face bottom-left
  // Front rectangle
  const frontPts = `${ox},${oy} ${ox + w},${oy} ${ox + w},${oy - h} ${ox},${oy - h}`;
  // Top rhombus
  const topPts = `${ox},${oy - h} ${ox + w},${oy - h} ${ox + w + d * 0.6},${oy - h - d * 0.5} ${ox + d * 0.6},${oy - h - d * 0.5}`;
  // Right rhombus
  const rightPts = `${ox + w},${oy} ${ox + w + d * 0.6},${oy - d * 0.5} ${ox + w + d * 0.6},${oy - h - d * 0.5} ${ox + w},${oy - h}`;

  return (
    <div className="bg-muted-bg/40 ring-border/60 flex items-center justify-center rounded-2xl p-6 ring-1">
      <svg
        viewBox="0 0 320 280"
        className="w-full max-w-sm text-ink-700"
        role="img"
        aria-label={`Dijagram dimenzija ${dims.w} × ${dims.d} × ${dims.h} cm`}
      >
        <polygon
          points={frontPts}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <polygon
          points={topPts}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <polygon
          points={rightPts}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        {/* Width label */}
        <text
          x={ox + w / 2}
          y={oy + 20}
          fontSize="11"
          textAnchor="middle"
          fill="currentColor"
          fontFamily="ui-monospace, monospace"
        >
          Š {dims.w} cm
        </text>
        {/* Height label */}
        <text
          x={ox - 10}
          y={oy - h / 2}
          fontSize="11"
          textAnchor="end"
          fill="currentColor"
          fontFamily="ui-monospace, monospace"
        >
          V {dims.h} cm
        </text>
        {/* Depth label */}
        <text
          x={ox + w + d * 0.6 + 6}
          y={oy - h - d * 0.25}
          fontSize="11"
          textAnchor="start"
          fill="currentColor"
          fontFamily="ui-monospace, monospace"
        >
          D {dims.d} cm
        </text>
      </svg>
    </div>
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
  if (p.allowsAssembly) {
    out.push({ code: "assembly", label: "Mogućnost montaže" });
  }
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

