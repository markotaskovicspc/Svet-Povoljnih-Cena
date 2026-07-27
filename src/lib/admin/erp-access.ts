import type { AdminRoleName } from "@prisma/client";

const CONTENT_MODULES = new Set([
  "artikli",
  "sifarnici-artikala",
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

const OPS_CONTENT_MODULES = new Set(["mp-cene"]);

const ADS_MODULES = new Set([
  "newsletter-kampanje",
  "posete-konverzije",
]);

const SHARED_MODULES = new Set([
  "racunovodstveni-registri",
]);

export function allowedRolesForErpModule(module: string): readonly AdminRoleName[] {
  if (module === "integracije" || module === "admin-podesavanja") return [];
  if (OPS_CONTENT_MODULES.has(module)) return ["CONTENT", "OPS"];
  if (CONTENT_MODULES.has(module)) return ["CONTENT"];
  if (ADS_MODULES.has(module)) return ["ADS"];
  if (SHARED_MODULES.has(module)) return ["CONTENT", "OPS", "ADS"];
  return ["OPS"];
}
