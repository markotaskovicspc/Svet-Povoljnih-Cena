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

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://www.googletagmanager.com`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com https://placehold.co https://www.google-analytics.com https://www.googletagmanager.com",
  "connect-src 'self' https://*.supabase.co https://www.google-analytics.com https://region1.google-analytics.com",
  "media-src 'self' https://*.supabase.co",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
