import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ list: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/api/search-listing", () => ({ listSearchProducts: mocks.list }));
vi.mock("@/lib/monitoring", () => ({ logOperationalError: mocks.log }));
vi.mock("@/components/listing/listing-shell", () => ({ ListingShell: () => null }));
import SearchPage from "@/app/(shop)/pretraga/page";
import { ListingShell } from "@/components/listing/listing-shell";

beforeEach(() => vi.clearAllMocks());

it("passes the search scope, complete count and continuation to the shared filter UI", async () => {
  const items = [{ sku: "search-result", groupedAttributes: [{ sectionId: "angle", optionId: "left" }] }];
  mocks.list.mockResolvedValue({ items, total: 1005, nextCursor: "next-page" });
  const result = await SearchPage({ searchParams: Promise.resolve({ q: "  Ugaona  " }) });
  expect(result.type).toBe(ListingShell);
  expect(result.props).toMatchObject({ source: items, total: 1005,
    initialNextCursor: "next-page", pageQuery: { searchQuery: "Ugaona" }, kind: "pretraga" });
  expect(mocks.list).toHaveBeenCalledWith("Ugaona", { limit: 36 });
});

it("keeps short queries and unavailable search separate from an empty catalog", async () => {
  const short = await SearchPage({ searchParams: Promise.resolve({ q: "ug" }) });
  expect(renderToStaticMarkup(short)).toContain("Unesite najmanje 3 znaka");
  expect(mocks.list).not.toHaveBeenCalled();
  mocks.list.mockRejectedValue(new Error("database down"));
  const unavailable = await SearchPage({ searchParams: Promise.resolve({ q: "ugaona" }) });
  expect(renderToStaticMarkup(unavailable)).toContain("Pretraga trenutno nije dostupna");
  expect(renderToStaticMarkup(unavailable)).toContain("Pokušaj ponovo");
  expect(mocks.log).toHaveBeenCalled();
});
