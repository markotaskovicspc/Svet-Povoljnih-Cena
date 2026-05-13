import type { Metadata } from "next";
import { headers } from "next/headers";
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
    default: "Svet Akcija — nameštaj na akciji",
    template: "%s · Svet Akcija",
  },
  description:
    "Akcijske cene, trajno zaštićene ponude i izbor nameštaja za ceo dom.",
  metadataBase: new URL("https://www.svetpovoljnihcena.rs"),
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Suppress storefront chrome on /admin — admin owns its own shell.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isAdmin = pathname.startsWith("/admin");
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
              <PromoBar bar={promoBar} />
              <Header />
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
