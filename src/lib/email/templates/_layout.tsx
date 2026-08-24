import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";

const COLORS = {
  blue: "#123F5A",
  blueSoft: "#EAF4F7",
  ink: "#172B36",
  muted: "#5F6F78",
  line: "#DCE6EA",
  page: "#F2F6F8",
  white: "#FFFFFF",
} as const;

export interface EmailLayoutProps {
  preview: string;
  children: ReactNode;
  footerNote?: string;
}

/** Table-based, inline-only shell that remains stable in Gmail and Outlook. */
export function EmailLayout({ preview, children, footerNote }: EmailLayoutProps) {
  return (
    <table
      lang="sr-Latn"
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      width="100%"
      style={{
        width: "100%",
        borderCollapse: "collapse",
        backgroundColor: COLORS.page,
        color: COLORS.ink,
        fontFamily:
          "Arial, Helvetica, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <tbody>
        <tr>
          <td align="center" style={{ padding: "28px 12px" }}>
            <span
              style={{
                display: "none",
                overflow: "hidden",
                maxHeight: 0,
                maxWidth: 0,
                opacity: 0,
                color: "transparent",
                lineHeight: "1px",
              }}
            >
              {preview}
            </span>
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              width="100%"
              style={{
                width: "100%",
                maxWidth: 640,
                borderCollapse: "separate",
                backgroundColor: COLORS.white,
                borderTop: `5px solid ${COLORS.blue}`,
                borderRadius: 12,
                boxShadow: "0 8px 24px rgba(18,63,90,0.10)",
              }}
            >
              <tbody>
                <tr>
                  <td style={{ padding: "28px 24px 18px" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${BRAND.url}/documents/garantni-list-logo.jpeg`}
                      alt={BRAND.name}
                      width="220"
                      height="36"
                      style={{
                        display: "block",
                        width: 220,
                        maxWidth: "78%",
                        height: "auto",
                        border: 0,
                      }}
                    />
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "8px 24px 32px" }}>{children}</td>
                </tr>
              </tbody>
            </table>
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              width="100%"
              style={{ width: "100%", maxWidth: 640, borderCollapse: "collapse" }}
            >
              <tbody>
                <tr>
                  <td
                    align="center"
                    style={{
                      padding: "18px 12px 0",
                      fontSize: 11,
                      color: COLORS.muted,
                      lineHeight: 1.6,
                    }}
                  >
                    {footerNote ??
                      "Dobili ste ovu poruku jer ste izvršili akciju na sajtu svetpovoljnihcena.rs."}
                    <br />
                    {BRAND.legalName} · Beograd, Srbija
                    <br />
                    <a
                      href={BRAND.url}
                      style={{ color: COLORS.blue, textDecoration: "underline" }}
                    >
                      {BRAND.domain}
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function EmailEyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 8px",
        color: COLORS.blue,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </p>
  );
}

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{
        color: COLORS.ink,
        fontSize: 28,
        lineHeight: 1.2,
        margin: "0 0 10px",
        letterSpacing: "-0.02em",
      }}
    >
      {children}
    </h1>
  );
}

export function EmailSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        color: COLORS.ink,
        fontSize: 16,
        lineHeight: 1.3,
        margin: "0 0 12px",
      }}
    >
      {children}
    </h2>
  );
}

export function EmailParagraph({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 12px",
        fontSize: 14,
        lineHeight: 1.65,
        color: COLORS.muted,
      }}
    >
      {children}
    </p>
  );
}

export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0}>
      <tbody>
        <tr>
          <td style={{ backgroundColor: COLORS.blue, borderRadius: 7 }}>
            <a
              href={href}
              style={{
                display: "inline-block",
                color: COLORS.white,
                padding: "13px 22px",
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1.2,
                textDecoration: "none",
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function EmailDivider() {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      width="100%"
      style={{ width: "100%", borderCollapse: "collapse" }}
    >
      <tbody>
        <tr>
          <td
            aria-hidden="true"
            style={{
              borderTop: `1px solid ${COLORS.line}`,
              height: 24,
              lineHeight: "24px",
            }}
          >
            &nbsp;
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function EmailNotice({ children }: { children: ReactNode }) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      width="100%"
      style={{
        width: "100%",
        borderCollapse: "separate",
        backgroundColor: COLORS.blueSoft,
        borderLeft: `4px solid ${COLORS.blue}`,
        borderRadius: 7,
      }}
    >
      <tbody>
        <tr>
          <td
            style={{
              padding: "14px 16px",
              color: COLORS.ink,
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
