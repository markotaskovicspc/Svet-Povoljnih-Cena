import { describe, expect, it, vi } from "vitest";
import { MyGlsClient } from "@/lib/mygls/client";
import type { MyGlsConfig } from "@/lib/mygls/config";

const config: MyGlsConfig = {
  enabled: true,
  autoCreate: true,
  env: "test",
  baseUrl: "https://mygls.test.invalid",
  username: "test@example.invalid",
  password: "secret",
  clientNumber: 123,
  senderIdentityCardNumber: "123456789",
  senderIdentityType: "PIB",
  webshopEngine: "SPC test",
  defaultContent: "Test",
  typeOfPrinter: "A4_2x2",
  labelBucket: "shipment-labels",
  statusCronSecret: "",
  codCardEnabled: false,
  contactServiceEnabled: false,
  flexDeliveryServiceEnabled: false,
  pickup: {
    name: "Svet povoljnih cena",
    street: "Evropska",
    houseNumber: "1",
    houseNumberInfo: "bb",
    city: "Stara Pazova",
    postalCode: "22300",
    country: "RS",
    contactName: "Test",
    contactPhone: "0600000000",
    contactEmail: "test@example.invalid",
  },
};

function clientWithResponse(body: unknown) {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
  return { client: new MyGlsClient(config, fetchImpl), fetchImpl };
}

describe("MyGLS cancellation response validation", () => {
  it("accepts deletion only when GLS confirms the requested parcel", async () => {
    const { client } = clientWithResponse({
      DeleteLabelsErrorList: [],
      SuccessfullyDeletedList: [{ ParcelId: 101, SubParcelIdList: [] }],
    });

    await expect(client.deleteLabels([101])).resolves.toMatchObject({
      SuccessfullyDeletedList: [{ ParcelId: 101 }],
    });
  });

  it("rejects an empty deletion acknowledgement", async () => {
    const { client } = clientWithResponse({
      DeleteLabelsErrorList: [],
      SuccessfullyDeletedList: [],
    });

    await expect(client.deleteLabels([101])).rejects.toThrow(
      "nije potvrdio otkazivanje",
    );
  });

  it("accepts COD modification only when GLS returns Successful true", async () => {
    const success = clientWithResponse({ ModifyCODError: [], Successful: true });
    await expect(
      success.client.modifyCOD({ parcelId: 101, codAmount: 1200 }),
    ).resolves.toMatchObject({ Successful: true });

    const failure = clientWithResponse({ ModifyCODError: [], Successful: false });
    await expect(
      failure.client.modifyCOD({ parcelId: 101, codAmount: 1200 }),
    ).rejects.toThrow("nije potvrdio izmenu otkupnine");
  });
});
