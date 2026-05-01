export { auth, signIn, signOut, handlers } from "@/lib/auth/auth";
export {
  getSession,
  getCurrentUser,
  requireUser,
  requireAdmin,
} from "@/lib/auth/session";
export {
  registerCustomer,
  issuePhoneOtp,
  verifyPhoneOtp,
  createPasswordResetToken,
  consumePasswordResetToken,
} from "@/lib/auth/credentials";
export {
  exportUserData,
  softDeleteAccount,
  setMarketingConsent,
} from "@/lib/auth/gdpr";
