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
  tryIssueFiscalReceipt,
  paymentMethodLabel,
  type FiscalIssueOutcome,
} from "./issue";
export {
  issueAndDeliverFiscalReceipt,
  type DeliverResult,
} from "./deliver";
