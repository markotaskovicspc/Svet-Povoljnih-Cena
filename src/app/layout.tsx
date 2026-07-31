import type { Metadata, Viewport } from "next";
import { Playfair_Display, Inter, JetBrains_Mono, Bebas_Neue } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/brand";

const fontDisplay = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const fontSans = Inter({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const fontMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Logo font — closest free Google equivalent to "Ahkio" (a tall, condensed
 * geometric sans). Bebas Neue gives the same poster-display feel for the
 * Fallback logo font kept for admin and legacy text marks.
 */
const fontLogo = Bebas_Neue({
  variable: "--font-logo",
  subsets: ["latin", "latin-ext"],
  weight: "400",
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
      className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable} ${fontLogo.variable} h-full antialiased`}
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
