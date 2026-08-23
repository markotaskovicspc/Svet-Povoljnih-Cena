import { BRAND } from "@/lib/brand";

export interface PurchaseOrderSupplierEmailProps {
  number: string;
  attachmentFilename: string;
}

export function PurchaseOrderSupplierEmail({
  number,
  attachmentFilename,
}: PurchaseOrderSupplierEmailProps) {
  return (
    <div
      lang="en"
      style={{
        backgroundColor: "#f4f1ec",
        color: "#201a17",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
        padding: "32px 16px",
      }}
    >
      <span
        style={{
          display: "none",
          maxHeight: 0,
          overflow: "hidden",
          opacity: 0,
        }}
      >
        New purchase order {number} from {BRAND.name}
      </span>

      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ maxWidth: 640, margin: "0 auto" }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "0 0 20px" }}>
              {/* Email clients need an ordinary image with inline dimensions. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${BRAND.url}/documents/garantni-list-logo.jpeg`}
                alt={BRAND.name}
                width="240"
                height="57"
                style={{
                  display: "block",
                  width: 240,
                  maxWidth: "72%",
                  height: "auto",
                }}
              />
            </td>
          </tr>
          <tr>
            <td
              style={{
                overflow: "hidden",
                backgroundColor: "#ffffff",
                border: "1px solid #e1d9cf",
                borderRadius: 16,
                boxShadow: "0 4px 14px rgba(46, 35, 24, 0.07)",
              }}
            >
              <div
                style={{
                  backgroundColor: "#251c17",
                  color: "#ffffff",
                  padding: "13px 30px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Purchase order
              </div>
              <div style={{ padding: "30px" }}>
                <h1
                  style={{
                    margin: "0 0 20px",
                    color: "#201a17",
                    fontFamily: "Georgia, 'Times New Roman', serif",
                    fontSize: 30,
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                >
                  New order {number}
                </h1>
                <p style={paragraphStyle}>Dear,</p>
                <p style={paragraphStyle}>
                  Please kindly confirm receipt of our new order.
                </p>
                <p style={paragraphStyle}>
                  If any parameters or specifications of the order are not
                  suitable or require adjustment, please inform us by email and
                  specify which parts need to be revised.
                </p>

                <table
                  role="presentation"
                  cellPadding={0}
                  cellSpacing={0}
                  width="100%"
                  style={{
                    margin: "24px 0",
                    backgroundColor: "#f8f5f0",
                    border: "1px solid #e5ddd3",
                    borderRadius: 12,
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ width: 44, padding: "16px 0 16px 16px" }}>
                        <div
                          style={{
                            width: 38,
                            borderRadius: 6,
                            backgroundColor: "#b42318",
                            color: "#ffffff",
                            fontSize: 10,
                            fontWeight: 800,
                            lineHeight: "30px",
                            textAlign: "center",
                          }}
                        >
                          PDF
                        </div>
                      </td>
                      <td style={{ padding: "16px" }}>
                        <div
                          style={{
                            color: "#201a17",
                            fontSize: 14,
                            fontWeight: 700,
                            lineHeight: 1.4,
                          }}
                        >
                          {attachmentFilename}
                        </div>
                        <div
                          style={{
                            marginTop: 3,
                            color: "#746960",
                            fontSize: 12,
                            lineHeight: 1.4,
                          }}
                        >
                          The complete order request is attached to this email.
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <p style={{ ...paragraphStyle, marginBottom: 0 }}>
                  Best regards
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td
              style={{
                padding: "18px 8px 0",
                color: "#746960",
                fontSize: 11,
                lineHeight: 1.6,
                textAlign: "center",
              }}
            >
              {BRAND.legalName}
              <br />
              <a
                href={BRAND.url}
                style={{ color: "#6b4423", textDecoration: "none" }}
              >
                {BRAND.domain}
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const paragraphStyle = {
  margin: "0 0 14px",
  color: "#443a34",
  fontSize: 15,
  lineHeight: 1.65,
} as const;
