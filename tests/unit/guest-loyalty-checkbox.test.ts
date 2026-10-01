import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ activate: vi.fn(), refresh: vi.fn(), member: { active: false, ready: true }, terms: { id: "2026-10", firstPurchasePct: 10, guestFirstPurchaseAllowed: false, freeCategoryOneThresholdRsd: 20000 } }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useId: () => "loyalty-test", useRef: () => ({ current: null }), useState: (value: unknown) => [value, vi.fn()] }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "unauthenticated", data: null }) }));
vi.mock("@/components/pricing/pricing-eligibility", () => ({ useLoyaltyEligibility: () => false }));
vi.mock("@/components/pricing/commerce-terms-provider", () => ({ useCommerceTerms: () => mocks.terms }));
vi.mock("@/lib/loyalty/use-guest-loyalty", () => ({ useGuestLoyalty: () => mocks.member, activateGuestLoyalty: mocks.activate, refreshGuestLoyalty: mocks.refresh }));
vi.mock("@/lib/hooks/use-cart", async (original) => {
  const actual = await original<typeof import("@/lib/hooks/use-cart")>();
  return { ...actual, useCart: Object.assign((select: (state: ReturnType<typeof actual.useCart.getState>) => unknown) => select(actual.useCart.getState()), actual.useCart) };
});
import { GuestLoyaltyOffer } from "@/components/cart/guest-loyalty-offer";
import { useCart } from "@/lib/hooks/use-cart";
import { LOYALTY_CONSENT_VERSION } from "@/lib/loyalty/shared";
function checkbox(node: unknown): ReactElement<{ onChange: (event: { target: { checked: boolean } }) => void }> | undefined {
  if (!node || typeof node !== "object") return;
  const element = node as ReactElement<{ type?: string; children?: unknown }>;
  if (element.type === "input" && element.props.type === "checkbox") return element as ReturnType<typeof checkbox>;
  for (const child of [element.props?.children].flat()) { const found = checkbox(child); if (found) return found; }
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.member.active = false; mocks.terms.guestFirstPurchaseAllowed = false;
  useCart.setState({ lines: [
    { sku: "regular", slug: "polica", name: "Polica", qty: 2, unitPriceFull: 1000, unitPriceSale: 1000, unitPriceLoyalty: 700 },
    { sku: "sale", slug: "mop", name: "Mop", qty: 1, unitPriceFull: 1000, unitPriceSale: 600 },
  ] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});
afterEach(() => vi.unstubAllGlobals());
it("removes the first-purchase promise from the guest consent checkbox in October", () => {
  const copy = () => {
    const tree = GuestLoyaltyOffer()!;
    const paragraph = tree.props.children.find((child: ReactElement<{ id?: string }> | null) => child?.props?.id === "loyalty-test-consent");
    return renderToStaticMarkup(paragraph);
  };
  expect(copy()).toContain("Bez naloga i kartice");
  expect(copy()).not.toContain("za prvu kupovinu");
  mocks.terms.guestFirstPurchaseAllowed = true;
  expect(copy()).toContain("za prvu kupovinu");
});
it("one checkbox submits explicit consent and immediately reprices eligible items without discounting sale items", async () => {
  checkbox(GuestLoyaltyOffer())!.props.onChange({ target: { checked: true } });
  await vi.waitFor(() => expect(mocks.activate).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith("/api/loyalty/request", expect.objectContaining({ method: "POST", body: JSON.stringify({ consent: true, consentVersion: LOYALTY_CONSENT_VERSION }) }));
  expect(useCart.getState().lines.map(line => [line.qty, line.unitPriceSale])).toEqual([[2, 700], [1, 600]]);
});
it("does not apply a discount when saving consent fails", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ message: "Pokušajte ponovo" }) } as Response);
  checkbox(GuestLoyaltyOffer())!.props.onChange({ target: { checked: true } });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(mocks.activate).not.toHaveBeenCalled();
  expect(useCart.getState().lines[0].unitPriceSale).toBe(1000);
});
it("unchecking removes the guest session and refreshes eligibility", async () => {
  mocks.member.active = true;
  checkbox(GuestLoyaltyOffer())!.props.onChange({ target: { checked: false } });
  await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith("/api/loyalty/status", { method: "DELETE" });
  expect(mocks.activate).not.toHaveBeenCalled();
});
