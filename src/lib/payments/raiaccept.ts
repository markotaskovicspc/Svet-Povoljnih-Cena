import "server-only";

export class RaiAcceptConfigError extends Error {}

export function getRaiAcceptPublicBaseUrl() {
  return (
    process.env.RAIACCEPT_PUBLIC_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function isRaiAcceptMethod(
  method: string,
): method is "KARTICA" | "GOOGLE_PAY" | "APPLE_PAY" {
  return method === "KARTICA" || method === "GOOGLE_PAY" || method === "APPLE_PAY";
}

export function requireRaiAcceptConfigured(): never {
  throw new RaiAcceptConfigError(
    "RaiAccept kartično plaćanje nije konfigurisano. Unesite parametre iz Raiffeisen ugovora pre aktiviranja kartica.",
  );
}
