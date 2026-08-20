import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/brand";

const fontSans = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default:
      "Svet povoljnih cena – mesto gde su dobre ponude dostupne svima!",
    template: `%s · ${BRAND.name}`,
  },
  description:
    "Dobrodošli na platformu koja iskustvo kupovine čini jednostavnim, sigurnim i bez stresa, uz produženu garanciju i kratke rokove isporuke.",
  metadataBase: new URL(BRAND.url),
  openGraph: {
    siteName: BRAND.name,
    type: "website",
    locale: "sr_RS",
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
