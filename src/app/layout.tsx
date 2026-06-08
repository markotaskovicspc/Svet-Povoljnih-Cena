import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Playfair_Display, Inter, JetBrains_Mono, Bebas_Neue } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { PromoBar } from "@/components/layout/promo-bar";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsletterBand } from "@/components/layout/newsletter-band";
import { FirstPurchaseCta } from "@/components/layout/first-purchase-cta";
import { getActivePromoBar, getActiveTabs } from "@/lib/storefront/content";
import { getCurrentUser } from "@/lib/auth/session";

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

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Suppress storefront chrome on /admin — admin owns its own shell.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isAdmin = pathname.startsWith("/admin");
  const [activePromoBar, activeTabs, currentUser] = isAdmin
    ? [null, [], null]
    : await Promise.all([getActivePromoBar(), getActiveTabs(), getCurrentUser()]);
  const isCustomerLoggedIn = currentUser?.userType === "customer";
  const showFirstPurchaseCta =
    !isAdmin &&
    !isCustomerLoggedIn &&
    !pathname.startsWith("/nalog") &&
    !pathname.startsWith("/checkout");
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
              <div className="sticky top-0 z-50 bg-white">
                <div
                  aria-hidden
                  className="h-[max(env(safe-area-inset-top),1.5rem)] bg-white md:hidden"
                />
                {activePromoBar ? <PromoBar bar={activePromoBar} /> : null}
                <Header tabs={activeTabs} isCustomerLoggedIn={isCustomerLoggedIn} />
              </div>
              <main className="flex-1">{children}</main>
              {showFirstPurchaseCta ? <FirstPurchaseCta /> : null}
              <NewsletterBand />
              <Footer />
            </>
          )}
        </Providers>
      </body>
    </html>
  );
}
