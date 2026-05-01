import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingShell } from "@/components/listing/listing-shell";
import { mockProducts } from "@/data/products";
import type { Crumb } from "@/components/layout/breadcrumbs";

/**
 * Catch-all category listing.
 *
 * URL → categoryPath:
 *   /k/namestaj/police/otvorene
 *   matches a product whose categoryPath, slugified, starts with the URL segments.
 *
 * In Phase 4 this resolves against the categories table; for now it filters the
 * mock catalog by slugified path equality.
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

function matchProductsByPath(slugSegments: string[]) {
  const wanted = slugSegments.map((s) => decodeURIComponent(s).toLowerCase());
  return mockProducts.filter((p) => {
    const segs = p.categoryPath.map(slugify);
    if (segs.length < wanted.length) return false;
    return wanted.every((w, i) => segs[i] === w);
  });
}

function resolveTrailAndTitle(slugSegments: string[]): {
  trail: Crumb[];
  title: string;
  subtitle?: string;
} | null {
  // Find the first product whose categoryPath matches; use it to derive labels.
  const wanted = slugSegments.map((s) => decodeURIComponent(s).toLowerCase());
  const sample = mockProducts.find((p) => {
    const segs = p.categoryPath.map(slugify);
    return wanted.every((w, i) => segs[i] === w);
  });
  if (!sample) return null;

  const labels = sample.categoryPath.slice(0, slugSegments.length);
  const trail: Crumb[] = labels.map((label, i) => ({
    label,
    href:
      i < labels.length - 1
        ? `/k/${labels.slice(0, i + 1).map(slugify).join("/")}`
        : undefined,
  }));
  return {
    trail,
    title: labels[labels.length - 1],
    subtitle: `${labels.join(" / ")} — kuratirana selekcija.`,
  };
}

interface RouteProps {
  params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = resolveTrailAndTitle(slug);
  if (!resolved) return { title: "Kategorija" };
  return {
    title: resolved.title,
    description: resolved.subtitle,
  };
}

export default async function CategoryPage({ params }: RouteProps) {
  const { slug } = await params;
  if (!slug?.length) notFound();
  const products = matchProductsByPath(slug);
  const resolved = resolveTrailAndTitle(slug);
  if (!resolved || !products.length) notFound();

  return (
    <ListingShell
      kind="kategorija"
      title={resolved.title}
      subtitle={resolved.subtitle}
      trail={resolved.trail}
      source={products}
    />
  );
}
