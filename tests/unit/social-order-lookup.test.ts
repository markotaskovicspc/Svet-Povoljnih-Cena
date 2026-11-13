import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findUnique: mocks.findUnique, findMany: mocks.findMany }, $queryRaw: mocks.queryRaw } }));
import { looseOrderNumber, sameAddress, sameName, samePhone, socialOrderLookup, socialOrderLookupRequest } from "@/lib/social/order-lookup";

const order = (over: Record<string, unknown> = {}) => ({
  number: "SPC-2026-002639",
  channel: "WEB",
  createdAt: new Date("2026-11-10T10:00:00Z"),
  status: "U_ISPORUCI",
  shipFirstName: "Kada",
  shipLastName: "Saitović",
  shipPhone: "0613256656",
  shipStreet: "Ilindenska 33",
  shipCity: "Leskovac",
  billFirstName: null,
  billLastName: null,
  items: [{ name: "Friteza FRY SMART 6L", qty: 1 }],
  ...over,
});
const lookup = (input: Record<string, unknown>) => socialOrderLookup(socialOrderLookupRequest.parse({ action: "order_lookup", ...input }));
beforeEach(() => vi.resetAllMocks());

it("reads loosely typed SPC numbers", () => {
  expect(looseOrderNumber("spc 2026 2639")).toBe("SPC-2026-002639");
  expect(looseOrderNumber("SPC-2026-002639")).toBe("SPC-2026-002639");
  expect(looseOrderNumber("9002942839")).toBeNull();
});

it("matches names regardless of order, case and missing diacritics", () => {
  expect(sameName("saitovic kada", "Kada", "Saitović")).toBe(true);
  expect(sameName("Djordje Petrovic", "Đorđe", "Petrović")).toBe(true);
  expect(sameName("Kada", "Kada", "Saitović")).toBe(false);
  expect(sameName("Kada Saitović Marko", "Kada", "Saitović")).toBe(false);
});

it("returns status and items by order number without contact data", async () => {
  mocks.findUnique.mockResolvedValue(order());
  const result = await lookup({ number: "spc-2026-2639" });
  expect(mocks.findUnique.mock.calls[0][0].where).toEqual({ number: "SPC-2026-002639" });
  expect(result).toEqual({ ok: true, orders: [{ number: "SPC-2026-002639", createdAt: "2026-11-10", status: "U_ISPORUCI", items: [{ name: "Friteza FRY SMART 6L", qty: 1 }] }] });
  expect(JSON.stringify(result)).not.toMatch(/Saitovi|Kada/);
});

it("matches phone and address loosely", () => {
  expect(samePhone("+381 61 325 6656", "0613256656")).toBe(true);
  expect(samePhone("061 111 2222", "0613256656")).toBe(false);
  expect(sameAddress("Ilindenska 33, 16000 Leskovac", "Ilindenska 33", "Leskovac")).toBe(true);
  expect(sameAddress("Ilindenska", "Ilindenska 33", "Leskovac")).toBe(false);
  expect(sameAddress("Kneza Miloša 5", "Ilindenska 33", "Leskovac")).toBe(false);
});

it("resolves another number (courier parcel) to the real SPC order through shipments", async () => {
  mocks.queryRaw.mockResolvedValue([{ orderId: "o1" }]);
  mocks.findMany.mockResolvedValue([order()]);
  const result = await lookup({ number: "9002942839" });
  expect(result).toMatchObject({ ok: true, matchedBy: "shipment", orders: [{ number: "SPC-2026-002639", status: "U_ISPORUCI" }] });
  expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ["o1"] }, channel: { not: "ANANAS" } });
  mocks.queryRaw.mockResolvedValue([]);
  expect(await lookup({ number: "9002942839" })).toEqual({ ok: true, matchedBy: "shipment", orders: [] });
  expect(await lookup({ number: "12" })).toEqual({ ok: false, error: "INVALID_ORDER_NUMBER" });
});

it("skips Ananas orders", async () => {
  mocks.findUnique.mockResolvedValue(order({ channel: "ANANAS" }));
  expect(await lookup({ number: "SPC-2026-002639" })).toEqual({ ok: true, orders: [] });
});

it("finds orders by full name only together with the address or phone from the order", async () => {
  expect(await lookup({ fullName: "Kada" })).toEqual({ ok: false, error: "FULL_NAME_REQUIRED" });
  expect(await lookup({ fullName: "Kada Saitović" })).toEqual({ ok: false, error: "ADDRESS_OR_PHONE_REQUIRED" });
  expect(mocks.queryRaw).not.toHaveBeenCalled();
  mocks.queryRaw.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  mocks.findMany.mockResolvedValue([order(), order({ number: "SPC-2026-002000", shipFirstName: "Amra" })]);
  const byPhone = await lookup({ fullName: "kada saitovic", phone: "061 3256656" });
  expect(byPhone.ok && byPhone.orders.map((o) => o.number)).toEqual(["SPC-2026-002639"]);
  const byAddress = await lookup({ fullName: "kada saitovic", address: "Ilindenska 33 Leskovac" });
  expect(byAddress.ok && byAddress.orders.map((o) => o.number)).toEqual(["SPC-2026-002639"]);
  const wrongPhone = await lookup({ fullName: "kada saitovic", phone: "0601112222" });
  expect(wrongPhone).toEqual({ ok: true, orders: [] });
});

it("issues a chat-bound reclamation proof only for a name + phone/address match", async () => {
  const secret = "s".repeat(40);
  const { readSocialQuote } = await import("@/lib/social/security");
  mocks.queryRaw.mockResolvedValue([{ id: "o1" }]);
  mocks.findMany.mockResolvedValue([order({ id: "o1" })]);
  const result = await socialOrderLookup(socialOrderLookupRequest.parse({ action: "order_lookup", fullName: "kada saitovic", phone: "0613256656", channel: "facebook", conversationId: "fb:123" }), secret);
  expect(result).toMatchObject({ ok: true, orders: [{ number: "SPC-2026-002639" }] });
  const proof = (result as { claimProofs: Record<string, string> }).claimProofs["SPC-2026-002639"];
  expect(readSocialQuote(proof, secret)).toMatchObject({ channel: "facebook", conversationId: "fb:123", purpose: "reclamation_owner", orderId: "o1", number: "SPC-2026-002639" });
  expect(JSON.stringify(result.orders)).not.toMatch(/o1|Saitovi/);

  mocks.findUnique.mockResolvedValue(order({ id: "o1" }));
  const byNumber = await socialOrderLookup(socialOrderLookupRequest.parse({ action: "order_lookup", number: "SPC-2026-002639", channel: "facebook", conversationId: "fb:123" }), secret);
  expect(byNumber).not.toHaveProperty("claimProofs");
  mocks.queryRaw.mockResolvedValue([{ id: "o1" }]);
  mocks.findMany.mockResolvedValue([order({ id: "o1" })]);
  const wrongPhone = await socialOrderLookup(socialOrderLookupRequest.parse({ action: "order_lookup", fullName: "kada saitovic", phone: "0601112222", channel: "facebook", conversationId: "fb:123" }), secret);
  expect(wrongPhone).not.toHaveProperty("claimProofs");
});
