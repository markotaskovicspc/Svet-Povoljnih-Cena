import type { AdminRoleName } from "@prisma/client";

const CONTENT_MODULES = new Set([
  "artikli",
  "sifarnici-artikala",
  "mp-cene",
  "cenovnici",
  "akcijske-cene",
  "loyalty",
  "linearne-promocije",
  "neobjavljeni-artikli",
  "heroji-meseca",
  "landing-strane",
  "landing-sekcije",
  "mobilni-tabovi",
  "pozicije-piktograma",
]);

const ADS_MODULES = new Set([
  "newsletter-kampanje",
  "posete-konverzije",
]);

const SHARED_MODULES = new Set([
  "racunovodstveni-registri",
  "matrica-zahteva",
]);

export function allowedRolesForErpModule(module: string): readonly AdminRoleName[] {
  if (module === "integracije" || module === "admin-podesavanja") return [];
  if (CONTENT_MODULES.has(module)) return ["CONTENT"];
  if (ADS_MODULES.has(module)) return ["ADS"];
  if (SHARED_MODULES.has(module)) return ["CONTENT", "OPS", "ADS"];
  return ["OPS"];
}
