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
  {
    code: "rabalux-color-temperature",
    label: "Promena temperature boje",
    iconUrl: "/brand/pictograms/rabalux/color-temperature.png",
  },
  {
    code: "rabalux-rgb",
    label: "RGB svetlo",
    iconUrl: "/brand/pictograms/rabalux/rgb.png",
  },
  {
    code: "rabalux-memory",
    label: "Memorijska funkcija",
    iconUrl: "/brand/pictograms/rabalux/memory.png",
  },
  {
    code: "rabalux-timer",
    label: "Tajmer",
    iconUrl: "/brand/pictograms/rabalux/timer.png",
  },
  {
    code: "rabalux-nightlight",
    label: "Noćno svetlo",
    iconUrl: "/brand/pictograms/rabalux/nightlight.png",
  },
  {
    code: "rabalux-own-design",
    label: "Rabalux dizajn",
    iconUrl: "/brand/pictograms/rabalux/own-design.png",
  },
  {
    code: "rabalux-starry-effect",
    label: "Efekat zvezdanog neba",
    iconUrl: "/brand/pictograms/rabalux/starry-effect.png",
  },
  {
    code: "rabalux-backlight",
    label: "Pozadinsko osvetljenje",
    iconUrl: "/brand/pictograms/rabalux/backlight.png",
  },
  {
    code: "rabalux-textile-cable",
    label: "Tekstilni kabl",
    iconUrl: "/brand/pictograms/rabalux/textile-cable.png",
  },
  {
    code: "rabalux-bluetooth",
    label: "Bluetooth kontrola",
    iconUrl: "/brand/pictograms/rabalux/bluetooth.png",
  },
  {
    code: "rabalux-usb-port",
    label: "USB priključak",
    iconUrl: "/brand/pictograms/rabalux/usb-port.png",
  },
  {
    code: "rabalux-usb-charging",
    label: "USB punjenje",
    iconUrl: "/brand/pictograms/rabalux/usb-charging.png",
  },
  {
    code: "rabalux-speaker",
    label: "Ugrađeni zvučnik",
    iconUrl: "/brand/pictograms/rabalux/speaker.png",
  },
  {
    code: "rabalux-microwave-sensor",
    label: "Mikrotalasni senzor pokreta",
    iconUrl: "/brand/pictograms/rabalux/microwave-sensor.png",
  },
  {
    code: "rabalux-motion-sensor",
    label: "Senzor pokreta",
    iconUrl: "/brand/pictograms/rabalux/motion-sensor.png",
  },
  {
    code: "rabalux-light-sensor",
    label: "Svetlosni senzor",
    iconUrl: "/brand/pictograms/rabalux/light-sensor.png",
  },
  {
    code: "rabalux-solar",
    label: "Solarno napajanje",
    iconUrl: "/brand/pictograms/rabalux/solar.png",
  },
  {
    code: "rabalux-wireless-charging",
    label: "Bežično punjenje",
    iconUrl: "/brand/pictograms/rabalux/wireless-charging.png",
  },
  {
    code: "rabalux-fan",
    label: "Ventilator",
    iconUrl: "/brand/pictograms/rabalux/fan.png",
  },
  {
    code: "rabalux-battery",
    label: "Baterija / akumulator",
    iconUrl: "/brand/pictograms/rabalux/battery.png",
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

function normalized(value: string | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
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
  if (affirmative(specValue(input.technicalSpecs, "Color_temp_change"))) {
    codes.push("rabalux-color-temperature");
  }
  if (affirmative(specValue(input.technicalSpecs, "RGB"))) {
    codes.push("rabalux-rgb");
  }
  if (affirmative(specValue(input.technicalSpecs, "Memory_function"))) {
    codes.push("rabalux-memory");
  }
  if (affirmative(specValue(input.technicalSpecs, "Timer_function"))) {
    codes.push("rabalux-timer");
  }
  if (affirmative(specValue(input.technicalSpecs, "Nightlight"))) {
    codes.push("rabalux-nightlight");
  }
  if (affirmative(specValue(input.technicalSpecs, "Rabalux_own_design"))) {
    codes.push("rabalux-own-design");
  }
  if (affirmative(specValue(input.technicalSpecs, "Starry_effect"))) {
    codes.push("rabalux-starry-effect");
  }
  if (affirmative(specValue(input.technicalSpecs, "Backlight"))) {
    codes.push("rabalux-backlight");
  }
  if (affirmative(specValue(input.technicalSpecs, "Textile_cable"))) {
    codes.push("rabalux-textile-cable");
  }
  if (affirmative(specValue(input.technicalSpecs, "Bluetooth"))) {
    codes.push("rabalux-bluetooth");
  }
  if (affirmative(specValue(input.technicalSpecs, "USB_charging_port"))) {
    codes.push("rabalux-usb-port");
  }
  if (affirmative(specValue(input.technicalSpecs, "Chargeable_w_USB"))) {
    codes.push("rabalux-usb-charging");
  }
  if (affirmative(specValue(input.technicalSpecs, "Speaker"))) {
    codes.push("rabalux-speaker");
  }

  const sensorType = normalized(specValue(input.technicalSpecs, "Sensor_type"));
  if (sensorType.includes("mikrotalas")) {
    codes.push("rabalux-microwave-sensor");
  } else if (sensorType.includes("pokret") || sensorType.includes("pir")) {
    codes.push("rabalux-motion-sensor");
  }
  if (sensorType.includes("svetlos") || sensorType.includes("svjetlos")) {
    codes.push("rabalux-light-sensor");
  }

  const otherFunctions = normalized(
    specValue(input.technicalSpecs, "Other_functions"),
  );
  if (otherFunctions.includes("solarn")) codes.push("rabalux-solar");
  if (otherFunctions.includes("bezicn") && otherFunctions.includes("punj")) {
    codes.push("rabalux-wireless-charging");
  }
  if (otherFunctions.includes("fan motor")) codes.push("rabalux-fan");

  const battery = normalized(specValue(input.technicalSpecs, "Battery"));
  if (battery && !/\bexcl\b/.test(battery)) codes.push("rabalux-battery");
  return codes.slice(0, RABALUX_PICTOGRAM_LIMIT);
}
