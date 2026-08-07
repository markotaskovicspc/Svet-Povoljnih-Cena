import type { RabaluxTechnicalSpec } from "./types";

export const RABALUX_PICTOGRAM_LIMIT = 6;

export const RABALUX_PICTOGRAMS = [
  {
    code: "rabalux-warranty-5",
    label: "5 godina garancije",
    iconUrl: "/brand/pictograms/rabalux/warranty-5.png",
  },
  {
    code: "rabalux-warranty-3",
    label: "3 godine garancije",
    iconUrl: "/brand/pictograms/rabalux/warranty-3.png",
  },
  {
    code: "rabalux-led",
    label: "LED tehnologija",
    iconUrl: "/brand/pictograms/rabalux/led.png",
  },
  {
    code: "rabalux-dimmable",
    label: "Prigušivanje",
    iconUrl: "/brand/pictograms/rabalux/dimmable.png",
  },
  {
    code: "rabalux-remote",
    label: "Daljinski upravljač",
    iconUrl: "/brand/pictograms/rabalux/remote-control.png",
  },
  {
    code: "rabalux-smart",
    label: "Smart / Wi‑Fi",
    iconUrl: "/brand/pictograms/rabalux/smart-wifi.png",
  },
  {
    code: "rabalux-ip44-plus",
    label: "IP44 ili viša zaštita",
    iconUrl: "/brand/pictograms/rabalux/ip44-plus.png",
  },
] as const;

export type RabaluxPictogramCode = (typeof RABALUX_PICTOGRAMS)[number]["code"];

export function rabaluxPictogramPriority(code: string) {
  const index = RABALUX_PICTOGRAMS.findIndex((item) => item.code === code);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function affirmative(value: string | undefined) {
  return /^(?:1|da|yes|true)$/i.test(value?.trim() ?? "");
}

function specValue(specs: RabaluxTechnicalSpec[], key: string) {
  return specs.find((spec) => spec.key === key)?.value;
}

function ipRating(value: string | undefined) {
  const match = value?.match(/\bIP\s*([0-9]{2})\b/i);
  return match ? Number(match[1]) : null;
}

/**
 * Product-level assignments are derived only from structured supplier fields.
 * Warranty badges require an explicit feed value; fallback warranties are not
 * promoted as a premium feature.
 */
export function deriveRabaluxPictogramCodes(input: {
  warrantyYears: number;
  warrantyExplicit: boolean;
  technicalSpecs: RabaluxTechnicalSpec[];
}): RabaluxPictogramCode[] {
  const codes: RabaluxPictogramCode[] = [];
  if (input.warrantyExplicit && input.warrantyYears === 5) {
    codes.push("rabalux-warranty-5");
  } else if (input.warrantyExplicit && input.warrantyYears === 3) {
    codes.push("rabalux-warranty-3");
  }
  if (affirmative(specValue(input.technicalSpecs, "LED_technology"))) {
    codes.push("rabalux-led");
  }
  if (affirmative(specValue(input.technicalSpecs, "Dimmable"))) {
    codes.push("rabalux-dimmable");
  }
  if (affirmative(specValue(input.technicalSpecs, "Remote_control"))) {
    codes.push("rabalux-remote");
  }
  if (affirmative(specValue(input.technicalSpecs, "Wi-Fi"))) {
    codes.push("rabalux-smart");
  }
  if ((ipRating(specValue(input.technicalSpecs, "IP_protection")) ?? 0) >= 44) {
    codes.push("rabalux-ip44-plus");
  }
  return codes.slice(0, RABALUX_PICTOGRAM_LIMIT);
}
