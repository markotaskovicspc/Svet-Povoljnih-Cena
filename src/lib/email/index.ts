/**
 * Phase 4D — public surface of the email module. Templates remain in
 * `./templates/*` for direct preview rendering; everything else goes
 * through the senders below.
 */
export { getEmailConfig } from "./config";
export { dispatch } from "./transport";
export type { DispatchResult, EmailAttachment } from "./transport";
export { renderEmail } from "./render";
export {
  sendOrderConfirmation,
  sendOrderStatusChanged,
  sendFiscalReceipt,
  sendReclamationReceipt,
  sendPasswordReset,
  sendOtpEmail,
  sendMagicLink,
} from "./send";
export {
  loadOrderForEmail,
  loadReclamationForEmail,
  lowerOrderStatus,
  type PrismaOrderStatus,
} from "./adapt";
export {
  normalizeInbound,
  handleInboundMessage,
  type InboundMessage,
  type InboundRouteResult,
} from "./inbound";
