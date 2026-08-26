import "server-only";

import { getMetaPixelId, type MetaCustomData, type MetaStandardEventName } from "@/lib/analytics/meta-ecommerce";

const DEFAULT_META_GRAPH_API_VERSION = "v24.0";

type MetaCapiEnvironment = {
  NEXT_PUBLIC_META_PIXEL_ID?: string;
  META_CAPI_TOKEN?: string;
  META_GRAPH_API_VERSION?: string;
  META_CAPI_TEST_EVENT_CODE?: string;
};

export type MetaCapiEvent = {
  eventName: MetaStandardEventName;
  eventId: string;
  eventSourceUrl: string;
  customData?: MetaCustomData;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
  eventTime?: number;
};

export function getMetaCapiConfig(
  environment?: MetaCapiEnvironment,
) {
  const source = environment ?? {
    NEXT_PUBLIC_META_PIXEL_ID: process.env.NEXT_PUBLIC_META_PIXEL_ID,
    META_CAPI_TOKEN: process.env.META_CAPI_TOKEN,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
    META_CAPI_TEST_EVENT_CODE: process.env.META_CAPI_TEST_EVENT_CODE,
  };
  const pixelId = getMetaPixelId(source.NEXT_PUBLIC_META_PIXEL_ID);
  const accessToken = configuredValue(source.META_CAPI_TOKEN);
  if (!pixelId || !accessToken) return null;

  const requestedVersion = configuredValue(source.META_GRAPH_API_VERSION);
  const apiVersion = requestedVersion && /^v\d+\.\d+$/.test(requestedVersion)
    ? requestedVersion
    : DEFAULT_META_GRAPH_API_VERSION;
  return {
    pixelId,
    accessToken,
    apiVersion,
    testEventCode: configuredValue(source.META_CAPI_TEST_EVENT_CODE),
  };
}

export async function sendMetaCapiEvent(
  event: MetaCapiEvent,
  options?: {
    environment?: MetaCapiEnvironment;
    fetchImpl?: typeof fetch;
  },
) {
  const config = getMetaCapiConfig(options?.environment);
  if (!config) return { sent: false as const, reason: "not_configured" as const };

  const userData = compact({
    client_ip_address: event.clientIpAddress,
    client_user_agent: event.clientUserAgent,
    fbp: event.fbp,
    fbc: event.fbc,
  });
  const payload = {
    data: [
      {
        event_name: event.eventName,
        event_time: event.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        event_source_url: event.eventSourceUrl,
        action_source: "website",
        user_data: userData,
        ...(event.customData ? { custom_data: event.customData } : {}),
      },
    ],
    ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
  };
  const url = new URL(
    `https://graph.facebook.com/${config.apiVersion}/${config.pixelId}/events`,
  );
  url.searchParams.set("access_token", config.accessToken);
  const response = await (options?.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Meta CAPI HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return { sent: true as const };
}

function configuredValue(value: string | null | undefined) {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized.startsWith("GET_FROM_") ||
    normalized.includes("PLACEHOLDER") ||
    normalized.startsWith("YOUR_")
  ) {
    return null;
  }
  return normalized;
}

function compact(input: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}
