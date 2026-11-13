import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findUnique: mocks.findUnique, findMany: mocks.findMany }, $queryRaw: mocks.queryRaw } }));
import { looseOrderNumber, sameName, socialOrderLookup, socialOrderLookupRequest } from "@/lib/social/order-lookup";

const order = (over: Record<string, unknown> = {}) => ({
  number: "SPC-2026-002639",
  channel: "WEB",
  createdAt: new Date("2026-11-10T10:00:00Z"),
  status: "U_ISPORUCI",
  shipFirstName: "Kada",
  shipLastName: "Saitović",
  billFirstName: null,
  billLastName: null,
  items: [{ name: "Friteza FRY SMART 6L", qty: 1 }],
  ...over,
});
const lookup = (input: Record<string, unknown>) => socialOrderLookup(socialOrderLookupRequest.parse({ action: "order_lookup", ...input }));
beforeEach(() => vi.resetAllMocks());

it("reads loosely typed SPC numbers and never treats courier numbers as orders", () => {
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

it("rejects a non-SPC number and skips Ananas orders", async () => {
  expect(await lookup({ number: "9002942839" })).toEqual({ ok: false, error: "INVALID_ORDER_NUMBER" });
  mocks.findUnique.mockResolvedValue(order({ channel: "ANANAS" }));
  expect(await lookup({ number: "SPC-2026-002639" })).toEqual({ ok: true, orders: [] });
});

it("finds orders by first and last name, requiring an exact full-name match", async () => {
  expect(await lookup({ fullName: "Kada" })).toEqual({ ok: false, error: "FULL_NAME_REQUIRED" });
  mocks.queryRaw.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  mocks.findMany.mockResolvedValue([order(), order({ number: "SPC-2026-002000", shipFirstName: "Amra" })]);
  const result = await lookup({ fullName: "kada saitovic" });
  expect(result.ok && result.orders.map((o) => o.number)).toEqual(["SPC-2026-002639"]);
});
