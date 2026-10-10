import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { xExpressStatusDisplay } from "@/lib/x-express/status-display";
import { XExpressTracking } from "@/components/admin/x-express-tracking";

describe("X Express carrier status visibility", () => {
  it("recovers specific exceptions from legacy generic messages", () => {
    expect(xExpressStatusDisplay({ status: "IN_TRANSIT", providerStatusCode: "RETURNING", message: "U tranzitu" }))
      .toEqual({ label: "Kreiran povrat", attention: true });
    expect(xExpressStatusDisplay({ status: "FAILED", providerStatusCode: "DLV_FAIL_ADDRESS_ERR", message: "Neuspešna isporuka" }))
      .toEqual({ label: "Netačna adresa", attention: true });
  });

  it("uses dictionary descriptions and exposes unknown codes instead of generic success", () => {
    expect(xExpressStatusDisplay({ status: "OUT_FOR_DELIVERY", providerStatusCode: "DLV_ASSIGNED", dictionaryLabel: "Zadužena za isporuku" }))
      .toEqual({ label: "Zadužena za isporuku", attention: false });
    expect(xExpressStatusDisplay({ status: "FAILED", providerStatusCode: "UNKNOWN_CODE", message: "Neuspešna isporuka" }))
      .toEqual({ label: "UNKNOWN_CODE", attention: true });
    expect(xExpressStatusDisplay({ status: "FAILED", providerStatusCode: "DLV_FAIL_PHONE_ERR", message: "Netačan telefon" }))
      .toEqual({ label: "Netačan telefon", attention: true });
  });

  it("shows both screenshot events without expanding a section, newest first, in Serbian time", () => {
    const html = renderToStaticMarkup(<XExpressTracking labels={new Map()} shipments={[{
      id: "shipment", trackingNo: "26-0001361093", status: "IN_TRANSIT", providerStatusCode: "RETURNING",
      lastStatusEventAt: new Date("2026-10-10T09:52:00Z"),
      events: [
        { id: "address", status: "FAILED", providerStatusCode: "DLV_FAIL_ADDRESS_ERR", message: "Neuspešna isporuka", occurredAt: new Date("2026-10-10T09:09:00Z") },
        { id: "return", status: "IN_TRANSIT", providerStatusCode: "RETURNING", message: "U tranzitu", occurredAt: new Date("2026-10-10T09:52:00Z") },
      ],
    }]} />);
    expect(html).toContain("26-0001361093");
    expect(html).toContain("Kreiran povrat");
    expect(html).toContain("Netačna adresa");
    expect(html).toContain("Potrebna je provera sa kurirom.");
    expect(html).toContain("11:52:00");
    expect(html).toContain("11:09:00");
    expect(html.indexOf("(RETURNING)")).toBeLessThan(html.indexOf("(DLV_FAIL_ADDRESS_ERR)"));
    expect(html).not.toContain("U tranzitu");
    expect(html).not.toContain("<details");
  });

  it("clears the current warning after recovery while preserving the failed attempt", () => {
    const html = renderToStaticMarkup(<XExpressTracking labels={new Map([["DELIVERED", "Isporučeno"]])} shipments={[{
      id: "shipment", trackingNo: "tracking", status: "DELIVERED", providerStatusCode: "DELIVERED", lastStatusEventAt: new Date(),
      events: [{ id: "address", status: "FAILED", providerStatusCode: "DLV_FAIL_ADDRESS_ERR", message: null, occurredAt: new Date() }],
    }]} />);
    expect(html).toContain("Isporučeno");
    expect(html).toContain("Netačna adresa");
    expect(html).not.toContain("Potrebna je provera sa kurirom.");
  });
});
