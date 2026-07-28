import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product/product-card";
import { getProductsBySkus } from "@/lib/api/catalog";
import { requireAdmin } from "@/lib/auth/session";
import { sanitizeRichText } from "@/lib/rich-text";
import {
  getLandingPageForAdminPreview,
  getLandingPageForStorefront,
} from "@/lib/storefront/landing-pages";

type RouteProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getLandingPageForStorefront(slug);
  if (!page) return { title: "Ponuda nije pronađena" };
  return {
    title: page.seoTitle || page.title,
    description: page.seoDescription || page.lead || undefined,
  };
}

export default async function LandingPageRoute({
  params,
  searchParams,
}: RouteProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const preview = query.preview === "1";
  if (preview) await requireAdmin();

  const page = preview
    ? await getLandingPageForAdminPreview(slug)
    : await getLandingPageForStorefront(slug);
  if (!page) notFound();

  const skus = page.sections.flatMap((section) => section.productSkus);
  const products = await getProductsBySkus(skus);
  const productBySku = new Map(products.map((product) => [product.sku, product]));

  return (
    <main className="min-h-screen bg-canvas pb-16">
      {preview ? (
        <div className="bg-warning px-4 py-2 text-center text-sm font-semibold text-ink-900">
          Admin pregled — ova verzija nije nužno javno objavljena.
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-[var(--container-page)] px-4 pt-5 md:px-6">
        <nav aria-label="Putanja" className="text-xs text-ink-500">
          <Link href="/" className="hover:text-brand-blue">
            Početna
          </Link>
          <span className="px-2" aria-hidden>
            /
          </span>
          <span aria-current="page">{page.title}</span>
        </nav>
      </div>

      <header className="mx-auto mt-4 w-full max-w-[var(--container-page)] px-4 md:px-6">
        <div className="relative overflow-hidden rounded-2xl bg-brand-blue text-white shadow-soft-2">
          {page.heroImageUrl ? (
            <Image
              src={page.heroImageUrl}
              alt=""
              fill
              priority
              sizes="(min-width: 1280px) 1200px, 100vw"
              className="object-cover opacity-45"
            />
          ) : null}
          <div className="relative z-10 max-w-3xl px-6 py-14 md:px-12 md:py-20">
            <h1 className="font-display text-3xl font-bold tracking-tight md:text-5xl">
              {page.title}
            </h1>
            {page.lead ? (
              <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-white/90 md:text-lg">
                {page.lead}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[var(--container-page)] space-y-14 px-4 py-10 md:px-6 md:py-14">
        {page.sections.map((section) => {
          const sectionProducts = section.productSkus
            .map((sku) => productBySku.get(sku))
            .filter(
              (product): product is NonNullable<typeof product> =>
                Boolean(product),
            );
          const body = section.body ? sanitizeRichText(section.body) : "";
          if (
            !section.title &&
            !body &&
            !section.imageUrl &&
            !sectionProducts.length
          ) {
            return null;
          }
          return (
            <section key={section.id} className="scroll-mt-28">
              <div
                className={
                  section.imageUrl
                    ? "grid items-center gap-6 md:grid-cols-2"
                    : "max-w-4xl"
                }
              >
                <div>
                  {section.title ? (
                    <h2 className="font-display text-2xl font-bold text-brand-blue md:text-3xl">
                      {section.title}
                    </h2>
                  ) : null}
                  {body ? (
                    <div
                      className="mt-3 space-y-3 text-sm leading-relaxed text-ink-700 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h3]:font-display [&_h3]:text-lg [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc"
                      dangerouslySetInnerHTML={{ __html: body }}
                    />
                  ) : null}
                </div>
                {section.imageUrl ? (
                  <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-white shadow-soft-1">
                    <Image
                      src={section.imageUrl}
                      alt={section.title ?? ""}
                      fill
                      sizes="(min-width: 768px) 50vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                ) : null}
              </div>

              {sectionProducts.length ? (
                <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {sectionProducts.map((product) => (
                    <ProductCard key={product.sku} product={product} />
                  ))}
                </div>
              ) : null}

              {preview &&
              section.productSkus.length > sectionProducts.length ? (
                <p className="mt-3 text-xs text-warning">
                  Neki SKU kodovi nisu pronađeni ili proizvodi nisu dostupni za
                  web.
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}
