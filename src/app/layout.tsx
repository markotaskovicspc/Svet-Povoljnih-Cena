import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/brand";
import { HOME_SEO_DESCRIPTION, HOME_SEO_TITLE } from "@/lib/seo";

const fontSans = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: HOME_SEO_TITLE,
    template: `%s · ${BRAND.name}`,
  },
  description: HOME_SEO_DESCRIPTION,
  metadataBase: new URL(BRAND.url),
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
  },
  openGraph: {
    title: HOME_SEO_TITLE,
    description: HOME_SEO_DESCRIPTION,
    siteName: BRAND.name,
    type: "website",
    locale: "sr_RS",
    url: "/",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="sr-Latn"
      suppressHydrationWarning
      className={`${fontSans.variable} h-full antialiased`}
    >
      <body
        suppressHydrationWarning
        className="bg-surface text-ink-900 min-h-full flex flex-col font-sans"
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
