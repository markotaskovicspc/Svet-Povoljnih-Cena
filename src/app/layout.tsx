import type { Metadata } from "next";
import { headers } from "next/headers";
import { Playfair_Display, Inter, JetBrains_Mono, Bebas_Neue } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PromoBar } from "@/components/layout/promo-bar";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsletterBand } from "@/components/layout/newsletter-band";
import { getActivePromoBar, getActiveTabs } from "@/lib/storefront/content";

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
    default: "Svet Akcija — premium nameštaj",
    template: "%s · Svet Akcija",
  },
  description:
    "Premium nameštaj po povoljnim cenama. Brza isporuka, montaža u glavnim gradovima, kuratirana selekcija kolekcija.",
  metadataBase: new URL("https://www.svetakcija.rs"),
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Suppress storefront chrome on /admin — admin owns its own shell.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isAdmin = pathname.startsWith("/admin");
  const [activePromoBar, activeTabs] = isAdmin
    ? [null, []]
    : await Promise.all([getActivePromoBar(), getActiveTabs()]);
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
          {isAdmin ? (
            <main className="flex-1">{children}</main>
          ) : (
            <>
              <div className="sticky top-0 z-40 md:contents">
                {activePromoBar ? <PromoBar bar={activePromoBar} /> : null}
                <Header tabs={activeTabs} />
              </div>
              <main className="flex-1">{children}</main>
              <NewsletterBand />
              <Footer />
            </>
          )}
        </Providers>
      </body>
    </html>
  );
}
