import type { NextConfig } from "next";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const nextPackageRoot = dirname(
  createRequire(import.meta.url).resolve("next/package.json"),
);
const turbopackRoot = commonAncestor(projectRoot, nextPackageRoot);

function commonAncestor(left: string, right: string) {
  let candidate = left;
  while (true) {
    const pathFromCandidate = relative(candidate, right);
    if (
      pathFromCandidate === "" ||
      (!pathFromCandidate.startsWith("..") && !isAbsolute(pathFromCandidate))
    ) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) return candidate;
    candidate = parent;
  }
}

const requestedDistDir = process.env.NEXT_DIST_DIR?.trim();
const distDir =
  requestedDistDir &&
  requestedDistDir !== "." &&
  requestedDistDir !== ".." &&
  /^[A-Za-z0-9._-]+$/.test(requestedDistDir)
    ? requestedDistDir
    : ".next";

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
const supabaseOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
})();
const upgradeInsecureRequests = (() => {
  // Local `next dev` is plain HTTP. A production HTTPS URL in `.env.local`
  // must not make WebKit rewrite localhost scripts to HTTPS and block hydration.
  if (process.env.NODE_ENV === "development") return false;

  const raw =
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_BASE_URL;
  if (!raw) return process.env.NODE_ENV === "production";

  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
})();

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://www.googletagmanager.com`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: https://*.supabase.co${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://images.unsplash.com https://placehold.co https://www.google-analytics.com https://www.googletagmanager.com`,
  `connect-src 'self' https://*.supabase.co${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://www.google-analytics.com https://region1.google-analytics.com`,
  `media-src 'self' https://*.supabase.co${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "worker-src 'self' blob:",
  ...(upgradeInsecureRequests ? ["upgrade-insecure-requests"] : []),
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
  distDir,
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    // Worktrees may share dependencies from a parent checkout. Next 16 only
    // resolves files inside this root, so use the smallest ancestor that
    // contains both the application and the resolved Next.js package.
    root: turbopackRoot,
  },
  outputFileTracingIncludes: {
    // Sharp is externalized by Next.js. Include its Linux runtime explicitly so
    // Vercel functions receive both the native addon and the libvips shared lib.
    "/*": [
      "node_modules/sharp/**/*",
      "node_modules/@img/sharp-linux-x64/**/*",
      "node_modules/@img/sharp-libvips-linux-x64/**/*",
    ],
  },
  experimental: {
    // Production builds query the session-mode Supabase database while
    // prerendering. Keep one worker so the 15-client session pool cannot be
    // exhausted by multiple worker-local Prisma pools.
    cpus: 1,
    serverActions: {
      // Admin media forms support one banner pair or up to ten 8 MB product images.
      bodySizeLimit: "85mb",
    },
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
