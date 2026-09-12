import { notFound } from "next/navigation";
import { getProductArAsset } from "@/lib/product-ar";
import ArLauncherEntry from "@/components/product/ar-launcher-entry";

export const metadata = { title: "Pogledaj u svojoj sobi", robots: { index: false, follow: false } };

export default async function ArPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const asset = getProductArAsset(slug);
  if (!asset) notFound();
  return <main className="flex min-h-dvh items-center justify-center bg-white p-6">
    <ArLauncherEntry asset={asset} productPath={`/p/${slug}`} />
  </main>;
}
