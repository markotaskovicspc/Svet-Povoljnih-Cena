/**
 * Re-exports for the Phase 2 transactional email templates.
 *
 * These render plain JSX in dev (preview); Phase 4 swaps the host elements for
 * `@react-email/components` so Resend can render them to HTML.
 */
export { OrderConfirmation } from "./order-confirmation";
export { OrderStatusChanged } from "./order-status-changed";
export { ReclamationReceipt } from "./reclamation-receipt";
export { PasswordReset } from "./password-reset";
export { OtpEmail } from "./otp";
