import { describe, expect, it, vi } from "vitest";
import {
  getMetaCapiConfig,
  sendMetaCapiEvent,
} from "@/lib/analytics/meta-capi.server";

const configuredEnvironment = {
  NEXT_PUBLIC_META_PIXEL_ID: "4622399164665144",
  META_CAPI_TOKEN: "test-server-access-token-123456",
  META_GRAPH_API_VERSION: "v24.0",
  META_CAPI_TEST_EVENT_CODE: "TEST123",
};

describe("Meta Conversions API transport", () => {
  it("treats truthy placeholders as unconfigured", () => {
    expect(
      getMetaCapiConfig({
        ...configuredEnvironment,
        META_CAPI_TOKEN: "GET_FROM_META_EVENTS_MANAGER",
      }),
    ).toBeNull();
  });

  it("sends the standard server event with the browser event ID for deduplication", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"events_received":1}', { status: 200 }),
    );

    const result = await sendMetaCapiEvent(
      {
        eventName: "AddToCart",
        eventId: "addtocart:event-1",
        eventSourceUrl: "https://www.svetpovoljnihcena.rs/p/test",
        clientIpAddress: "203.0.113.10",
        clientUserAgent: "Test Browser",
        fbp: "fb.1.123.456",
        customData: {
          currency: "RSD",
          value: 999,
          content_ids: ["SKU-1"],
          content_type: "product",
          contents: [{ id: "SKU-1", quantity: 1, item_price: 999 }],
        },
        eventTime: 1_787_700_000,
      },
      { environment: configuredEnvironment, fetchImpl },
    );

    expect(result).toEqual({ sent: true });
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe("/v24.0/4622399164665144/events");
    expect(url.searchParams.get("access_token")).toBe(
      "test-server-access-token-123456",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      data: [
        expect.objectContaining({
          event_name: "AddToCart",
          event_time: 1_787_700_000,
          event_id: "addtocart:event-1",
          event_source_url: "https://www.svetpovoljnihcena.rs/p/test",
          action_source: "website",
          user_data: {
            client_ip_address: "203.0.113.10",
            client_user_agent: "Test Browser",
            fbp: "fb.1.123.456",
          },
          custom_data: expect.objectContaining({
            currency: "RSD",
            value: 999,
            content_ids: ["SKU-1"],
          }),
        }),
      ],
      test_event_code: "TEST123",
    });
  });
});
