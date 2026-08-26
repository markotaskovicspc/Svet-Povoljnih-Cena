# Meta Pixel activation

The storefront integration is inactive unless `NEXT_PUBLIC_META_PIXEL_ID` is a
valid numeric Pixel ID. Truthy `GET_FROM_*` placeholders are treated as unset.

## Environment

```dotenv
NEXT_PUBLIC_META_PIXEL_ID="4622399164665144"
META_CAPI_TOKEN=""
META_GRAPH_API_VERSION="v24.0"
META_CAPI_TEST_EVENT_CODE=""
```

`NEXT_PUBLIC_META_PIXEL_ID` enables the consent-gated browser Pixel. A Vercel
redeploy is required because public Next.js environment variables are inlined
at build time.

`META_CAPI_TOKEN` optionally enables the server-side Conversions API. Keep it
server-only. `META_CAPI_TEST_EVENT_CODE` is for a short Events Manager test and
must be empty in Vercel Production.

## Events

| Store action | Meta event | Browser + CAPI deduplication |
| --- | --- | --- |
| Route view | `PageView` | Shared generated `event_id` |
| Product detail | `ViewContent` | Shared generated `event_id` |
| Add to cart | `AddToCart` | Shared generated `event_id` |
| Checkout data step | `InitiateCheckout` | Shared generated `event_id` |
| Eligible completed order | `Purchase` | Stable `purchase:{orderNumber}` |

The catalog identifier is always the concrete product SKU. `Purchase` CAPI
data is rebuilt from the server-authorized order rather than trusted from the
browser.

## Activation checklist

1. Set the Pixel ID locally and for Vercel Preview and Production.
2. Optionally set the CAPI token and temporary test event code.
3. Publish the updated legal defaults with:
   `node scripts/publish-system-content-pages.mjs politika-privatnosti podesavanja-kolacica`
4. Redeploy so the public Pixel ID is included in the browser bundle.
5. In Meta Events Manager Test Events, grant marketing consent and verify the
   five standard events. Browser and server copies should be deduplicated.
6. Remove `META_CAPI_TEST_EVENT_CODE`, redeploy, and verify Diagnostics.

The raw Meta `<noscript>` tracking image is intentionally omitted because it
would transmit a page view before JavaScript can enforce marketing consent.
