import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Phase 1 mocks. Replaced by the supplier cloud base URL in Phase 4.
      { protocol: "https", hostname: "placehold.co" },
    ],
    // placehold.co serves image/svg+xml; required so the optimizer accepts it.
    // Replace with a raster CDN in Phase 4 and remove this flag.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
