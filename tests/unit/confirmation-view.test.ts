import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Order } from "@/types";
const mocked = vi.hoisted(() => ({ oldOrder: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/checkout/store", () => ({ useCheckout: (select: (state: unknown) => unknown) => select({ lastOrder: mocked.oldOrder, resetProgress: vi.fn() }) }));
vi.mock("@/components/analytics/first-party-analytics", () => ({ PurchaseAnalytics: () => null }));
vi.mock("@/components/orders/cancel-order-button", () => ({ CancelOrderButton: () => null }));
import { ConfirmationView } from "@/components/checkout/confirmation-view";
it("fresh server order must take priority over a different order left in browser memory", () => {
  const order = {
    id: "SPC-OLD-ORDER", status: "kreirano", items: [], total: 1000, subtotal: 1000,
    savings: 0, shipping: 0, assemblyTotal: 0, paymentMethod: "pouzece_gotovina", shippingMethod: "kurir",
    shippingAddress: { id: "a", firstName: "Test", lastName: "Kupac", phone: "060000000", street: "Test 1", city: "Beograd", postalCode: "11000", country: "RS" },
    createdAt: "2026-09-19T08:00:00Z", updatedAt: "2026-09-19T08:00:00Z",
  } as Order;
  mocked.oldOrder = order;
  const html = renderToStaticMarkup(createElement(ConfirmationView, { initialOrder: { ...order, id: "SPC-NEW-SERVER-ORDER", total: 2000 } }));
  expect(html.includes("SPC-NEW-SERVER-ORDER")).toBe(true);
  expect(html.includes("SPC-OLD-ORDER")).toBe(false);
});

it("does not display a remembered order when server authorization returned no order", () => {
  mocked.oldOrder = { id: "PRIVATE-OLD-ORDER" };
  expect(renderToStaticMarkup(createElement(ConfirmationView, { initialOrder: null }))).toBe("");
});
