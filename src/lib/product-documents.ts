export const PRODUCT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const PRODUCT_ATTACHMENT_SECTION_OPTIONS = [
  { value: "DELIVERY_TERMS", label: "Uslovi isporuke" },
  { value: "DECLARATION", label: "Deklaracija" },
  { value: "ASSEMBLY_INSTRUCTIONS", label: "Uputstvo za sastavljanje" },
  { value: "MAINTENANCE", label: "Kako održavati" },
] as const;

export type ProductAttachmentSectionValue =
  | "GENERAL"
  | (typeof PRODUCT_ATTACHMENT_SECTION_OPTIONS)[number]["value"];

export const PRODUCT_DOCUMENT_ACCEPT =
  ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";

export function productAttachmentSectionLabel(
  section: ProductAttachmentSectionValue,
) {
  if (section === "GENERAL") return "Dokumenti";
  return (
    PRODUCT_ATTACHMENT_SECTION_OPTIONS.find((option) => option.value === section)
      ?.label ?? section
  );
}
