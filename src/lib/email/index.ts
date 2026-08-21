/**
 * Phase 4D — public surface of the email module. Templates remain in
 * `./templates/*` for direct preview rendering; everything else goes
 * through the senders below.
 */
export { getEmailConfig } from "./config";
export { dispatch } from "./transport";
export type { DispatchResult, EmailAttachment } from "./transport";
export { renderEmail } from "./render";
export { processUrgentAdminAlerts } from "./admin-alerts";
export {
  sendOrderConfirmation,
  sendIpsPaymentConfirmation,
  sendOrderStatusChanged,
  sendFiscalReceipt,
  sendReclamationReceipt,
  sendReclamationStatusChanged,
  sendGuestReclamationLink,
  sendPasswordReset,
  sendOtpEmail,
  sendMagicLink,
  sendEmailConfirmation,
  sendBackInStockAlert,
  sendOnSaleAlert,
} from "./send";
export {
  trackedDispatch,
  recordProviderEvent,
  isEmailSuppressed,
} from "./tracking";
export {
  buildEmailUnsubscribeUrl,
  buildEmailUnsubscribeToken,
  verifyEmailUnsubscribeToken,
  applyEmailUnsubscribe,
} from "./unsubscribe";
export {
  syncNewsletterSubscriberToResend,
  syncUserMarketingConsentToResend,
  syncResendMarketingContacts,
} from "./resend-marketing";
export {
  loadOrderForEmail,
  loadReclamationForEmail,
  lowerOrderStatus,
  lowerReclamationStatus,
  type PrismaOrderStatus,
  type PrismaReclamationStatus,
} from "./adapt";
export {
  normalizeInbound,
  handleInboundMessage,
  classifyInboundMessage,
  type InboundMessage,
  type InboundAttachmentMetadata,
  type InboundRouteResult,
} from "./inbound";
export {
  processResendInboundEmail,
  retrieveReceivedEmail,
  loadInboundAttachmentLinks,
  removeInboundAttachments,
  inboundEmailIdFromSubject,
  type StoredInboundAttachment,
  type InboundAttachmentLink,
} from "./resend-receiving";
