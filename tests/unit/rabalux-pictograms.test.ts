import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RABALUX_PICTOGRAMS,
  deriveRabaluxPictogramCodes,
  rabaluxPictogramPriority,
} from "@/lib/rabalux/pictograms";

describe("Rabalux pictogram rules", () => {
  it("keeps every library definition unique and backed by a local asset", () => {
    expect(new Set(RABALUX_PICTOGRAMS.map((item) => item.code)).size).toBe(
      RABALUX_PICTOGRAMS.length,
    );
    for (const pictogram of RABALUX_PICTOGRAMS) {
      expect(
        existsSync(join(process.cwd(), "public", pictogram.iconUrl)),
        pictogram.iconUrl,
      ).toBe(true);
    }
  });

  it("shows explicit three-year warranty but not a derived warranty", () => {
    expect(
      deriveRabaluxPictogramCodes({
        warrantyYears: 3,
        warrantyExplicit: true,
        technicalSpecs: [],
      }),
    ).toEqual(["rabalux-warranty-3"]);
    expect(
      deriveRabaluxPictogramCodes({
        warrantyYears: 5,
        warrantyExplicit: false,
        technicalSpecs: [],
      }),
    ).toEqual([]);
  });

  it("requires a numeric IP rating of at least 44", () => {
    const codes = (value: string) =>
      deriveRabaluxPictogramCodes({
        warrantyYears: 2,
        warrantyExplicit: false,
        technicalSpecs: [{ key: "IP_protection", label: "IP", value }],
      });
    expect(codes("IP43")).not.toContain("rabalux-ip44-plus");
    expect(codes("IP44")).toContain("rabalux-ip44-plus");
    expect(codes("Zaštita IP65")).toContain("rabalux-ip44-plus");
  });

  it("keeps warranty ahead of feature badges", () => {
    expect(rabaluxPictogramPriority("rabalux-warranty-5")).toBeLessThan(
      rabaluxPictogramPriority("rabalux-led"),
    );
    expect(rabaluxPictogramPriority("rabalux-led")).toBeLessThan(
      rabaluxPictogramPriority("rabalux-ip44-plus"),
    );
  });

  it("derives the extended structured lighting features", () => {
    const technicalSpecs = [
      ["Color_temp_change", "da"],
      ["RGB", "da"],
      ["Memory_function", "da"],
      ["Timer_function", "da"],
      ["Nightlight", "da"],
      ["Rabalux_own_design", "da"],
    ].map(([key, value]) => ({ key, label: key, value }));

    expect(
      deriveRabaluxPictogramCodes({
        warrantyYears: 2,
        warrantyExplicit: false,
        technicalSpecs,
      }),
    ).toEqual([
      "rabalux-color-temperature",
      "rabalux-rgb",
      "rabalux-memory",
      "rabalux-timer",
      "rabalux-nightlight",
      "rabalux-own-design",
    ]);
  });

  it("derives sensor and free-text product features without overfilling the PDP", () => {
    const technicalSpecs = [
      { key: "Sensor_type", label: "Senzor", value: "Mikrotalasni senzor pokreta, svetlosni senzor" },
      { key: "Other_functions", label: "Ostalo", value: "Bežično punjenje i Fan motor 15W" },
      { key: "USB_charging_port", label: "USB", value: "da" },
      { key: "Battery", label: "Baterija", value: "3,7V 1200mAh" },
    ];

    const codes = deriveRabaluxPictogramCodes({
      warrantyYears: 2,
      warrantyExplicit: false,
      technicalSpecs,
    });
    expect(codes).toContain("rabalux-microwave-sensor");
    expect(codes).toContain("rabalux-light-sensor");
    expect(codes).toContain("rabalux-wireless-charging");
    expect(codes).toContain("rabalux-fan");
    expect(codes).toContain("rabalux-usb-port");
    expect(codes).toHaveLength(6);
  });

  it("does not advertise a battery that the customer must provide", () => {
    expect(
      deriveRabaluxPictogramCodes({
        warrantyYears: 2,
        warrantyExplicit: false,
        technicalSpecs: [
          { key: "Battery", label: "Baterija", value: "3XAA excl." },
        ],
      }),
    ).not.toContain("rabalux-battery");
  });
});
