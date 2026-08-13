export function isUnsafeFiscalRedispatch(input: {
  dispatchedAt: Date | null;
  error: string | null;
}) {
  if (!input.dispatchedAt) return false;
  if (input.error?.startsWith("fiscal:config")) return false;
  if (input.error && /^fiscal:4\d\d(?::|\s)/.test(input.error)) return false;
  return true;
}
