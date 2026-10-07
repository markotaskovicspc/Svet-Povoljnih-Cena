import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), guest: vi.fn(), log: vi.fn(), token: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => ({ id: "customer", userType: "customer" }) }));
vi.mock("@/lib/api/reclamations", () => ({
  createReclamation: mocks.create,
  createGuestReclamation: mocks.guest,
  listReclamationsForUser: vi.fn(),
  createReclamationSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
}));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimitForRequest: async () => ({ ok: true }), RATE_LIMITS: { reclamation: {} }, rateLimitJson: vi.fn(),
}));
vi.mock("@/lib/monitoring", () => ({ logOperationalError: mocks.log }));
vi.mock("@/lib/api/order-access", () => ({ readOrderAccessToken: mocks.token }));

import { POST } from "@/app/api/reclamations/route";

const request = () => new Request("http://localhost/api/reclamations", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ orderNumberOrFiscal: "SPC-2026-1", sku: "A", quantity: 1, description: "Problem sa proizvodom.", photos: [] }),
});

beforeEach(() => vi.clearAllMocks());

describe("reclamation creation errors", () => {
  it("logs unexpected database errors and returns a safe message", async () => {
    const error = new Error("Invalid prisma.reclamation.create(): database internals");
    mocks.create.mockRejectedValueOnce(error);
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false, error: "creation_failed", message: "Slanje reklamacije trenutno nije uspelo. Pokušajte ponovo.",
    });
    expect(mocks.log).toHaveBeenCalledWith("reclamation.create_failed", error);
  });

  it("keeps quantity errors distinct from unexpected failures", async () => {
    mocks.create.mockResolvedValueOnce({ ok: false, reason: "QUANTITY_EXCEEDED" });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, reason: "QUANTITY_EXCEEDED" });
    expect(mocks.log).not.toHaveBeenCalled();
  });
});

it("uses the order-scoped link even when another customer is logged in", async () => {
  mocks.token.mockReturnValueOnce("rcl1.scoped.signature");
  mocks.guest.mockResolvedValueOnce({ ok: true, number: "R-1-SPC-1", id: "r1" });
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(mocks.guest).toHaveBeenCalledWith(expect.anything(), "rcl1.scoped.signature");
  expect(mocks.create).not.toHaveBeenCalled();
});
