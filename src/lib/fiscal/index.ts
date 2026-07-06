/**
 * Phase 4F — public surface of the eFiskal module.
 */
export {
  getFiscalConfig,
  FiscalConfigError,
  type FiscalConfig,
  type FiscalProvider,
} from "./config";
export {
  fiscalize,
  type FiscalInvoiceInput,
  type FiscalInvoiceLine,
  type FiscalReceiptResponse,
  type FiscalDispatchResult,
} from "./transport";
export {
  buildFiscalReceiptPdf,
  type FiscalReceiptPdfInput,
} from "./pdf";
export {
  issueFiscalReceiptForOrder,
  issueFiscalSale,
  issueFiscalRefund,
  tryIssueFiscalReceipt,
  isOrderFullyFiscalized,
  getIssuedSaleDocumentsForOrder,
  ensureDefaultWarehouse,
  paymentMethodLabel,
  type FiscalIssueOutcome,
  type FiscalRefundOutcome,
} from "./issue";
export {
  issueAndDeliverFiscalReceipt,
  type DeliverResult,
} from "./deliver";
export {
  retryPendingFiscalDocuments,
  type FiscalRetrySummary,
} from "./retry";
export {
  uploadFiscalPdf,
  downloadFiscalPdf,
} from "./pdf-storage";
