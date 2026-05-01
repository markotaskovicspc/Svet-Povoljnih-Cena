/**
 * React Email components — preview-only renderers used in Phase 2 to lock
 * copy/structure. Phase 4 swaps the host element to `@react-email/components`
 * so the same JSX can be rendered into HTML by Resend.
 *
 * Until then, these compile to ordinary divs/tables and can be rendered in a
 * future internal `/admin/email-preview` route.
 */
import type { ReactNode } from "react";

export interface EmailLayoutProps {
  preview: string;
  children: ReactNode;
  footerNote?: string;
}

export function EmailLayout({
  preview,
  children,
  footerNote,
}: EmailLayoutProps) {
  return (
    <div
      lang="sr-Latn"
      style={{
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        backgroundColor: "#FAF7F2",
        color: "#1A1714",
        padding: "32px 16px",
      }}
    >
      <span style={{ display: "none", overflow: "hidden", maxHeight: 0 }}>
        {preview}
      </span>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ maxWidth: 560, margin: "0 auto" }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "0 0 24px" }}>
              <span
                style={{
                  fontFamily: "Fraunces, Georgia, serif",
                  fontSize: 22,
                  letterSpacing: "-0.01em",
                  color: "#1A1714",
                }}
              >
                Svet Povoljnih Cena
              </span>
            </td>
          </tr>
          <tr>
            <td
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 16,
                padding: 32,
                boxShadow: "0 2px 6px rgba(46,35,24,0.06)",
              }}
            >
              {children}
            </td>
          </tr>
          <tr>
            <td
              style={{
                padding: "20px 8px",
                fontSize: 11,
                color: "#6B6259",
                lineHeight: 1.5,
              }}
            >
              {footerNote ??
                "Dobili ste ovu poruku jer ste izvršili akciju na svetpovoljnihcena.rs."}
              <br />
              Svet Povoljnih Cena d.o.o. · Beograd, Srbija ·{" "}
              <a
                href="https://www.svetpovoljnihcena.rs"
                style={{ color: "#6B4423" }}
              >
                www.svetpovoljnihcena.rs
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{
        fontFamily: "Fraunces, Georgia, serif",
        fontSize: 26,
        margin: "0 0 8px",
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </h1>
  );
}

export function EmailParagraph({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 12px",
        fontSize: 14,
        lineHeight: 1.6,
        color: "#3B342D",
      }}
    >
      {children}
    </p>
  );
}

export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      style={{
        display: "inline-block",
        backgroundColor: "#1A1714",
        color: "#FAF7F2",
        padding: "12px 22px",
        borderRadius: 999,
        fontSize: 14,
        fontWeight: 500,
        textDecoration: "none",
      }}
    >
      {children}
    </a>
  );
}

export function EmailDivider() {
  return (
    <hr
      style={{
        border: 0,
        borderTop: "1px solid #E8E0D2",
        margin: "20px 0",
      }}
    />
  );
}
