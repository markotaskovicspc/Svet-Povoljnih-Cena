import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono, Bebas_Neue } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PromoBar } from "@/components/layout/promo-bar";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsletterBand } from "@/components/layout/newsletter-band";
import { promoBar } from "@/data/site";

const fontDisplay = Fraunces({
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
 * "Svet povoljnih cena" wordmark across header + footer.
 */
const fontLogo = Bebas_Neue({
  variable: "--font-logo",
  subsets: ["latin", "latin-ext"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Svet povoljnih cena — premium nameštaj",
    template: "%s · Svet povoljnih cena",
  },
  description:
    "Premium nameštaj po povoljnim cenama. Brza isporuka, montaža u glavnim gradovima, kuratirana selekcija kolekcija.",
  metadataBase: new URL("https://www.svetpovoljnihcena.rs"),
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
        <Providers>
          <PromoBar bar={promoBar} />
          <Header />
          <main className="flex-1">{children}</main>
          <NewsletterBand />
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
