import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyHeaders: vi.fn(),
  parseBatch: vi.fn(),
  verifyContract: vi.fn(),
  stageBatch: vi.fn(),
}));

vi.mock("@/lib/x-express/webhook", () => ({
  verifyXExpressWebhookHeaders: mocks.verifyHeaders,
  parseXExpressWebhookBatch: mocks.parseBatch,
  isXExpressWebhookContractValid: mocks.verifyContract,
  stageXExpressWebhookBatch: mocks.stageBatch,
}));

import { POST } from "@/app/api/x-express/webhook/route";

const event = {
  ContractId: "U000328",
  NotifyId: "758bb513-499d-4ab1-8697-5e747602f222",
  ReferenceId: "f32f5f7a-ec27-43c5-a7d9-5f628834b0fa",
  Status: "CREATED",
  StatusTime: "2026-07-26T12:00:00Z",
};

beforeEach(() => {
  mocks.verifyHeaders.mockReturnValue(true);
  mocks.parseBatch.mockReturnValue([event]);
  mocks.verifyContract.mockReturnValue(true);
  mocks.stageBatch.mockResolvedValue(undefined);
});

describe("X Express webhook route response", () => {
  it("stages the event and immediately returns the required empty HTTP 200", async () => {
    const response = await POST(
      new Request("https://example.invalid/api/x-express/webhook", {
        method: "POST",
        body: JSON.stringify([event]),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(mocks.stageBatch).toHaveBeenCalledWith([event]);
  });

  it("rejects authentication, invalid JSON and the wrong contract", async () => {
    mocks.verifyHeaders.mockReturnValueOnce(false);
    const unauthorized = await POST(
      new Request("https://example.invalid/api/x-express/webhook", {
        method: "POST",
        body: "[]",
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.text()).toBe("");

    mocks.parseBatch.mockImplementationOnce(() => {
      throw new Error("bad body");
    });
    const invalidBody = await POST(
      new Request("https://example.invalid/api/x-express/webhook", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(invalidBody.status).toBe(400);

    mocks.verifyContract.mockReturnValueOnce(false);
    const invalidContract = await POST(
      new Request("https://example.invalid/api/x-express/webhook", {
        method: "POST",
        body: JSON.stringify([event]),
      }),
    );
    expect(invalidContract.status).toBe(400);
    expect(mocks.stageBatch).not.toHaveBeenCalled();
  });
});
