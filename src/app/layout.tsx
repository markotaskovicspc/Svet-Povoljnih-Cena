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
    default: `${BRAND.name} — povoljne cene za dom`,
    template: `%s · ${BRAND.name}`,
  },
  description:
    "Povoljni proizvodi za dom, tehniku, putovanja i svakodnevnu kupovinu. Brza isporuka, sigurno plaćanje i akcijske cene.",
  metadataBase: new URL(BRAND.url),
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
