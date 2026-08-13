export function isRecoverableRabaluxMediaFailure(
  lastError: string | null,
) {
  if (!lastError?.startsWith("[permanent]")) return true;
  return /\b413\b|cannot fit the configured storage limit|payload too large|maximum allowed size|entity too large/i.test(
    lastError,
  );
}
