import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SefApiError, SefClient } from "@/lib/sef/client";

const config = {
  environment: "production" as const,
  baseUrl: "https://efaktura.example.invalid",
  apiKey: "private-test-key",
};

describe("SEF client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("authenticates centrally and parses invoice IDs", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ salesInvoiceIds: [12, 34] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await new SefClient(config, request).listSalesInvoiceIds({
      dateFrom: new Date("2026-08-24T00:00:00.000Z"),
      dateTo: new Date("2026-08-25T00:00:00.000Z"),
    });

    expect(result.salesInvoiceIds).toEqual([12, 34]);
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toContain("/api/publicApi/sales-invoice/ids");
    expect((init?.headers as Record<string, string>).ApiKey).toBe(
      "private-test-key",
    );
  });

  it("normalizes a provider validation error", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ message: "Period nije dozvoljen" }), {
        status: 400,
      }),
    );

    await expect(
      new SefClient(config, request).listSalesInvoiceIds({
        dateFrom: new Date("2026-08-24T00:00:00.000Z"),
        dateTo: new Date("2026-08-25T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("retries one rate-limited read and surfaces retry metadata", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("too many", {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ salesInvoiceIds: [] }), { status: 200 }),
      );
    const delay = vi.fn(async () => undefined);

    await expect(
      new SefClient(config, request, delay).healthCheck(
        new Date("2026-08-25T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ ok: true, recentInvoiceCount: 0 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("rejects an unexpected success shape", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ invoices: [] }), { status: 200 }),
    );
    await expect(
      new SefClient(config, request).healthCheck(
        new Date("2026-08-25T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(SefApiError);
  });
});
