import { describe, expect, it, vi } from "vitest";
import { submitEotpremnicaDocument } from "@/lib/admin/dispatch-note.server";

const config = { baseUrl: "https://sandbox.eotpremnica.test", apiKey: "secret" };
const input = {
  requestId: "dispatch-fixed-id",
  number: "OTP/2026/1",
  ubl: "<DespatchAdvice />",
};

describe("eOtpremnica transport contract", () => {
  it("validates XML and submits the same stable request id", async () => {
    const requestIds: string[] = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      if (String(url).includes("xml-validator")) {
        return new Response(JSON.stringify([{ isValid: true, hasErrors: false }]), { status: 200 });
      }
      requestIds.push(String(form.get("RequestId")));
      return new Response(JSON.stringify({ id: "document-1", status: "SUBMITTED" }), { status: 200 });
    }) as typeof fetch;

    const first = await submitEotpremnicaDocument(config, input, request);
    const second = await submitEotpremnicaDocument(config, input, request);

    expect(first.submission).toEqual({ id: "document-1", status: "SUBMITTED" });
    expect(second.submission).toEqual(first.submission);
    expect(requestIds).toEqual([input.requestId, input.requestId]);
  });

  it("rejects validator errors and never submits", async () => {
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            isValid: false,
            hasErrors: true,
            messages: [{ severity: "Error", code: "UBL-1", description: "Neispravan red" }],
          },
        ]),
        { status: 200 },
      ),
    ) as typeof fetch;

    await expect(submitEotpremnicaDocument(config, input, request)).rejects.toThrow(
      "UBL-1: Neispravan red",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed validator responses", async () => {
    const request = vi.fn(async () => new Response("not-json", { status: 200 })) as typeof fetch;
    await expect(submitEotpremnicaDocument(config, input, request)).rejects.toThrow(
      "nije vratio ispravan JSON",
    );
  });

  it("propagates timeout/network failures without manufacturing success", async () => {
    const request = vi.fn(async () => {
      throw new DOMException("Timed out", "TimeoutError");
    }) as typeof fetch;
    await expect(submitEotpremnicaDocument(config, input, request)).rejects.toThrow(
      "Timed out",
    );
  });
});
