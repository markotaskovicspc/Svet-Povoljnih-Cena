import { describe, expect, it } from "vitest";
import { myGlsErrorMessage } from "@/lib/mygls/error-message";
import { MyGlsClient } from "@/lib/mygls/client";
import { getMyGlsConfig } from "@/lib/mygls/config";
import type { MyGlsParcel } from "@/lib/mygls/types";

const address = { Name: "Test", Street: "Test", HouseNumber: "1", City: "Beograd (Vračar)", ZipCode: "11104", CountryIsoCode: "RS" };
const parcel: MyGlsParcel = { ClientNumber: 123, ClientReference: "SPC-2026-001321", Count: 1, Content: "Test", SenderIdentityCardNumber: "123", PickupAddress: {...address, ZipCode: "22300"}, DeliveryAddress: address };

describe("MyGLS actionable errors", () => {
  it("identifies the recipient postcode actually rejected by the provider", () => {
    expect(myGlsErrorMessage("Invalid data in 'Delivery Zip Code'", [parcel.ClientReference], [parcel]))
      .toBe("GLS je odbio poštanski broj „11104“ u adresi primaoca za nalog SPC-2026-001321. Proverite poštanski broj u GLS šifarniku za to mesto; broj iz šifarnika drugog kurira može da se razlikuje.");
  });
  it("uses the pickup address for pickup errors and the exact parcel reference", () => {
    const other = {...parcel, ClientReference: "OTHER", PickupAddress: {...address, ZipCode: "99999"}};
    const message = myGlsErrorMessage("Invalid data in 'Pickup Zip Code'", [parcel.ClientReference], [other, parcel]);
    expect(message).toContain("„22300“ u adresi preuzimanja");
    expect(message).not.toContain("99999");
  });
  it("does not guess a value for missing or multiple parcel identities", () => {
    for (const refs of [[], ["UNKNOWN"], [parcel.ClientReference, "OTHER"]]) {
      expect(myGlsErrorMessage("Invalid data in 'Delivery Zip Code'", refs, [parcel, {...parcel, ClientReference: "OTHER"}]))
        .not.toContain("11104");
    }
  });
  it("preserves unfamiliar provider explanations", () => {
    expect(myGlsErrorMessage("New provider error", [], [parcel])).toBe("New provider error");
    expect(myGlsErrorMessage("Invalid data in 'Unknown Field'", [], [parcel])).toBe("Invalid data in 'Unknown Field'");
  });
  it("keeps the raw rejection and code while the real client returns the explanation", async () => {
    const raw = { PrintLabelsErrorList: [{ ErrorCode: 13, ErrorDescription: "Invalid data in 'Delivery Zip Code'", ClientReferenceList: [parcel.ClientReference] }], PrintLabelsInfoList: [] };
    const cfg = {...getMyGlsConfig(), baseUrl: "https://mygls.example.invalid", username: "private-user", password: "private-password"};
    const client = new MyGlsClient(cfg, async () => new Response(JSON.stringify(raw)));
    await expect(client.printLabels({parcelList: [parcel]})).rejects.toMatchObject({
      message: myGlsErrorMessage(raw.PrintLabelsErrorList[0].ErrorDescription, [parcel.ClientReference], [parcel]),
      providerCode: "13", definitiveRejection: true, raw,
    });
  });
});
