import { BRAND } from "@/lib/brand";
import {
  EmailDivider,
  EmailEyebrow,
  EmailHeading,
  EmailLayout,
  EmailParagraph,
} from "./_layout";

export interface PurchaseOrderSupplierEmailProps {
  number: string;
  attachmentFilename: string;
}

export function PurchaseOrderSupplierEmail({
  number,
  attachmentFilename,
}: PurchaseOrderSupplierEmailProps) {
  return (
    <EmailLayout
      lang="en"
      preview={`New purchase order ${number} from ${BRAND.name}`}
      footer={
        <>
          {BRAND.legalName}
          <br />
          <a
            href={BRAND.url}
            style={{ color: "#123F5A", textDecoration: "underline" }}
          >
            {BRAND.domain}
          </a>
        </>
      }
    >
      <EmailEyebrow>Purchase order</EmailEyebrow>
      <EmailHeading>New order {number}</EmailHeading>
      <EmailParagraph>Dear,</EmailParagraph>
      <EmailParagraph>
        Please kindly confirm receipt of our new order.
      </EmailParagraph>
      <EmailParagraph>
        If any parameters or specifications of the order are not suitable or
        require adjustment, please inform us by email and specify which parts
        need to be revised.
      </EmailParagraph>

      <EmailDivider />

      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{
          width: "100%",
          margin: "0 0 20px",
          borderCollapse: "collapse",
        }}
      >
        <tbody>
          <tr>
            <td style={{ width: 46, padding: "5px 10px 5px 0", verticalAlign: "top" }}>
              <span
                style={{
                  display: "inline-block",
                  width: 36,
                  height: 22,
                  borderRadius: 4,
                  backgroundColor: "#123F5A",
                  color: "#FFFFFF",
                  fontSize: 9,
                  fontWeight: 800,
                  lineHeight: "22px",
                  letterSpacing: "0.04em",
                  textAlign: "center",
                }}
              >
                PDF
              </span>
            </td>
            <td style={{ padding: "5px 0", color: "#172B36", lineHeight: 1.45 }}>
              <div
                style={{
                  color: "#172B36",
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
                  color: "#5F6F78",
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

      <EmailParagraph>Best regards</EmailParagraph>
    </EmailLayout>
  );
}
