export const PROCUREMENT_DOCUMENT_ACCEPT =
  ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";

export type ProcurementDocumentOwnerType = "purchaseOrder" | "inboundInvoice";

export type ProcurementDocumentView = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  ownerType: ProcurementDocumentOwnerType;
};
