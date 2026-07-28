import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CmsMarkdown } from "@/components/content/cms-markdown";
import { ProductCard } from "@/components/product/product-card";
import { buttonVariants } from "@/components/ui/button";
import { getProductsBySkus } from "@/lib/api/catalog";
import { requireAdmin } from "@/lib/auth/session";
import { BRAND } from "@/lib/brand";
import { db } from "@/lib/db";
import type { LandingBlock, LandingPageSnapshot } from "@/lib/landing-pages/blocks";
import { getTabTitleIcon } from "@/lib/storefront/content";
import {
  getLandingPageForAdminPreview,
  getLandingPageForStorefront,
} from "@/lib/storefront/landing-pages";
import { cn } from "@/lib/utils";

type RouteProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type LandingPictogram = { id: string; label: string; iconUrl: string };

function absoluteUrl(value: string) {
  return value.startsWith("https://")
    ? value
    : `${BRAND.url}${value.startsWith("/") ? value : `/${value}`}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: RouteProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const preview = query.preview === "1";
  if (preview) await requireAdmin();
  const page = preview
    ? await getLandingPageForAdminPreview(slug)
    : await getLandingPageForStorefront(slug);
  if (!page) {
    return {
      title: "Ponuda nije pronađena",
      robots: { index: false, follow: false },
    };
  }
  const snapshot = page.snapshot;
  const title = snapshot.seoTitle || snapshot.title;
  const description = snapshot.seoDescription || snapshot.lead || undefined;
  const canonical = absoluteUrl(snapshot.canonicalUrl || `/ponuda/${page.slug}`);
  const image = snapshot.ogImageUrl || snapshot.heroImageUrl;
  return {
    title,
    description,
    alternates: { canonical },
    robots: preview
      ? { index: false, follow: false }
      : { index: snapshot.robotsIndex, follow: snapshot.robotsIndex },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: BRAND.name,
      title,
      description,
      images: image
        ? [{ url: absoluteUrl(image), alt: snapshot.heroImageAlt || snapshot.title }]
        : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [absoluteUrl(image)] : undefined,
    },
  };
}

export default async function LandingPageRoute({ params, searchParams }: RouteProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const preview = query.preview === "1";
  if (preview) await requireAdmin();
  const page = preview
    ? await getLandingPageForAdminPreview(slug)
    : await getLandingPageForStorefront(slug);
  if (!page) notFound();

  const blocks = page.snapshot.blocks.filter((block) => block.visible);
  const skus = blocks.flatMap((block) =>
    block.type === "PRODUCT_GRID" ? block.productSkus : [],
  );
  const pictogramIds = Array.from(
    new Set([
      ...Object.values(page.snapshot.heroPictograms).filter(
        (id): id is string => Boolean(id),
      ),
      ...blocks.flatMap((block) =>
        block.type === "PICTOGRAM_ROW"
          ? block.items.map((item) => item.pictogramId)
          : [],
      ),
    ]),
  );
  const [products, pictograms, titleIcon] = await Promise.all([
    getProductsBySkus(skus),
    pictogramIds.length
      ? db.pictogram.findMany({ where: { id: { in: pictogramIds } } })
      : [],
    getTabTitleIcon(`/ponuda/${encodeURIComponent(slug)}`),
  ]);
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const pictogramById = new Map(
    pictograms.map((pictogram) => [pictogram.id, pictogram]),
  );

  return (
    <div className="min-h-screen bg-canvas pb-16">
      {preview ? (
        <div className="bg-warning px-4 py-2 text-center text-sm font-semibold text-ink-900">
          Admin pregled nacrta — ova verzija nije nužno javno objavljena.
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-[var(--container-page)] px-4 pt-5 md:px-6">
        <nav aria-label="Putanja" className="text-xs text-ink-500">
          <Link href="/" className="hover:text-brand-blue">Početna</Link>
          <span className="px-2" aria-hidden>/</span>
          <span aria-current="page">{page.snapshot.title}</span>
        </nav>
      </div>
      <LandingHero
        snapshot={page.snapshot}
        pictogramById={pictogramById}
        titleIcon={titleIcon}
      />
      <div className="mx-auto w-full max-w-[var(--container-page)] space-y-12 px-4 py-10 md:px-6 md:py-14">
        {blocks.map((block) => (
          <LandingBlockView
            key={block.id}
            block={block}
            productBySku={productBySku}
            pictogramById={pictogramById}
            preview={preview}
          />
        ))}
      </div>
    </div>
  );
}

function LandingHero({
  snapshot,
  pictogramById,
  titleIcon,
}: {
  snapshot: LandingPageSnapshot;
  pictogramById: Map<string, LandingPictogram>;
  titleIcon: Awaited<ReturnType<typeof getTabTitleIcon>>;
}) {
  const image = snapshot.heroImageUrl;
  return (
    <header className="mx-auto mt-4 w-full max-w-[var(--container-page)] px-4 md:px-6">
      <div className="relative isolate min-h-[360px] overflow-hidden rounded-2xl bg-brand-blue text-white shadow-soft-2 md:min-h-[440px]">
        {image ? (
          <>
            <Image src={snapshot.heroMobileImageUrl || image} alt={snapshot.heroImageAlt || ""} fill priority sizes="100vw" className="object-cover opacity-45 md:hidden" />
            <Image src={image} alt={snapshot.heroImageAlt || ""} fill priority sizes="(min-width: 1280px) 1200px, 100vw" className="hidden object-cover opacity-45 md:block" />
          </>
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-r from-brand-blue/90 via-brand-blue/55 to-transparent" aria-hidden />
        {Object.entries(snapshot.heroPictograms).map(([slot, id]) => {
          const pictogram = id ? pictogramById.get(id) : null;
          if (!pictogram) return null;
          const positions: Record<string, string> = {
            TOP_LEFT_1: "left-5 top-5",
            TOP_LEFT_2: "left-20 top-5",
            BOTTOM_RIGHT_1: "bottom-5 right-20",
            BOTTOM_RIGHT_2: "bottom-5 right-5",
          };
          return (
            <div key={slot} className={cn("absolute z-20 size-12 rounded-full bg-white/90 p-2 shadow-lg md:size-14", positions[slot])}>
              <Image src={pictogram.iconUrl} alt={pictogram.label} width={56} height={56} className="size-full object-contain" />
            </div>
          );
        })}
        <div className="relative z-10 flex min-h-[360px] max-w-3xl flex-col justify-center px-6 py-16 md:min-h-[440px] md:px-12">
          <div className="flex items-center gap-4">
            {titleIcon ? (
              <Image
                src={titleIcon.url}
                alt={titleIcon.alt ?? ""}
                width={titleIcon.width ?? 96}
                height={titleIcon.height ?? 96}
                unoptimized={titleIcon.url.endsWith(".svg")}
                className="size-14 shrink-0 object-contain md:size-20"
              />
            ) : null}
            <h1 className="font-display text-3xl font-bold tracking-tight md:text-5xl">
              {snapshot.title}
            </h1>
          </div>
          {snapshot.lead ? <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-white/90 md:text-lg">{snapshot.lead}</p> : null}
          {snapshot.heroCtaLabel && snapshot.heroCtaHref ? (
            <div className="mt-7"><ActionLink href={snapshot.heroCtaHref} className={buttonVariants({ variant: "secondary", size: "lg" })}>{snapshot.heroCtaLabel}</ActionLink></div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function LandingBlockView({
  block,
  productBySku,
  pictogramById,
  preview,
}: {
  block: LandingBlock;
  productBySku: Map<string, Awaited<ReturnType<typeof getProductsBySkus>>[number]>;
  pictogramById: Map<string, LandingPictogram>;
  preview: boolean;
}) {
  if (block.type === "RICH_TEXT") {
    return <section className="mx-auto max-w-4xl scroll-mt-28">{block.title ? <h2 className="mb-4 font-display text-2xl font-bold text-brand-blue md:text-3xl">{block.title}</h2> : null}<CmsMarkdown markdown={block.bodyMarkdown} /></section>;
  }
  if (block.type === "BANNER") {
    const dark = block.theme === "DARK";
    return <section className={cn("relative isolate overflow-hidden rounded-2xl p-6 md:p-10", dark ? "bg-brand-blue text-white" : "bg-white text-ink-900 shadow-soft-1")}>
      {block.imageDesktopUrl ? <><Image src={block.imageMobileUrl || block.imageDesktopUrl} alt={block.imageAlt || ""} fill sizes="100vw" className="-z-10 object-cover opacity-25 md:hidden" /><Image src={block.imageDesktopUrl} alt={block.imageAlt || ""} fill sizes="(min-width: 1280px) 1200px, 100vw" className="-z-10 hidden object-cover opacity-25 md:block" /></> : null}
      <div className="max-w-2xl">{block.eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-walnut">{block.eyebrow}</p> : null}<h2 className="mt-2 font-display text-2xl font-bold md:text-4xl">{block.title}</h2>{block.body ? <p className={cn("mt-3 leading-relaxed", dark ? "text-white/85" : "text-ink-600")}>{block.body}</p> : null}{block.ctaLabel && block.ctaHref ? <div className="mt-6"><ActionLink href={block.ctaHref} className={buttonVariants({ variant: dark ? "secondary" : "default" })}>{block.ctaLabel}</ActionLink></div> : null}</div>
    </section>;
  }
  if (block.type === "PRODUCT_GRID") {
    const products = block.productSkus
      .map((sku) => productBySku.get(sku))
      .filter((product): product is NonNullable<typeof product> => Boolean(product));
    return <section className="scroll-mt-28">{block.title ? <h2 className="font-display text-2xl font-bold text-brand-blue md:text-3xl">{block.title}</h2> : null}{block.body ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-600">{block.body}</p> : null}{products.length ? <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{products.map((product) => <ProductCard key={product.sku} product={product} />)}</div> : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-ink-500">Trenutno nema dostupnih proizvoda u ovom izboru.</p>}{preview && block.productSkus.length > products.length ? <p className="mt-3 text-xs text-warning">Neki SKU kodovi nisu pronađeni ili trenutno nisu dostupni za web.</p> : null}</section>;
  }
  if (block.type === "PICTOGRAM_ROW") {
    return <section>{block.title ? <h2 className="text-center font-display text-2xl font-bold text-brand-blue md:text-3xl">{block.title}</h2> : null}<div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{block.items.map((item, index) => { const pictogram = pictogramById.get(item.pictogramId); if (!pictogram) return null; const content = <><Image src={pictogram.iconUrl} alt="" width={64} height={64} className="mx-auto size-14 object-contain" /><span className="mt-3 block text-sm font-semibold">{item.label || pictogram.label}</span></>; return item.href ? <ActionLink key={`${item.pictogramId}-${index}`} href={item.href} className="rounded-2xl bg-white p-5 text-center shadow-soft-1 transition hover:-translate-y-0.5">{content}</ActionLink> : <div key={`${item.pictogramId}-${index}`} className="rounded-2xl bg-white p-5 text-center shadow-soft-1">{content}</div>; })}</div></section>;
  }
  const dark = block.theme === "DARK";
  return <section className={cn("rounded-2xl px-6 py-10 text-center md:px-12", dark ? "bg-brand-blue text-white" : "bg-white text-ink-900 shadow-soft-1")}><h2 className="font-display text-2xl font-bold md:text-4xl">{block.title}</h2>{block.body ? <p className={cn("mx-auto mt-3 max-w-2xl", dark ? "text-white/85" : "text-ink-600")}>{block.body}</p> : null}<div className="mt-6"><ActionLink href={block.ctaHref} className={buttonVariants({ variant: dark ? "secondary" : "default", size: "lg" })}>{block.ctaLabel}</ActionLink></div></section>;
}

function ActionLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const external = href.startsWith("https://");
  return <Link href={href} className={className} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined}>{children}</Link>;
}
