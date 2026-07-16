import type { NextConfig } from "next";

function getSupabaseImagePattern() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const bucket =
      process.env.NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET ??
      process.env.SUPABASE_STORAGE_BUCKET ??
      "product-media";

    return {
      protocol: parsed.protocol.replace(":", "") as "http" | "https",
      hostname: parsed.hostname,
      pathname: `/storage/v1/object/public/${bucket}/**`,
    };
  } catch {
    return null;
  }
}

const supabaseImagePattern = getSupabaseImagePattern();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    staticGenerationMaxConcurrency: 2,
    staticGenerationMinPagesPerWorker: 50,
  },
  images: {
    // Keep storefront media on direct CDN URLs so Vercel does not spend
    // Image Optimization transformations on every product thumbnail variant.
    unoptimized: true,
    remotePatterns: [
      // Phase 1 mocks. Replaced by the supplier cloud base URL in Phase 4.
      { protocol: "https", hostname: "placehold.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      // Signed URLs for private buckets (reclamation photos).
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/sign/**",
      },
      ...(supabaseImagePattern ? [supabaseImagePattern] : []),
    ],
    // placehold.co serves image/svg+xml; required so the optimizer accepts it.
    // Replace with a raster CDN in Phase 4 and remove this flag.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
