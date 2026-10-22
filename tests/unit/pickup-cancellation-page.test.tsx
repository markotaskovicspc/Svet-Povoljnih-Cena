import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ batch: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  pickupBatch: { findUnique: mocks.batch },
  shipment: { findMany: async () => [] },
} }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn(), withAdminState: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/admin/pickup-availability.server", () => ({ getPickupPostingAvailability: async () => ({ provider: "X_EXPRESS", available: true, reason: null }) }));
import PickupBatchPage from "@/app/admin/erp/preuzimanja/[id]/page";

it("retains cancelled parcels and offers removal while disabling the label button even when all packages are ready", async () => {
  mocks.batch.mockResolvedValue({
    id: "batch", number: "PRE-2026-0090", provider: "X_EXPRESS", status: "DRAFT",
    labelsCreationStartedAt: null, labelsCreatedAt: null, configurationIssue: null, createdAt: new Date(),
    lines: [{
      id: "parcel", batchId: "batch", orderId: "cancelled", lineGroupKey: "order:cancelled",
      purpose: "ORDER_DELIVERY", orderItemId: null, reclamationId: null, packageNo: 1,
      quantity: 1, packedQuantity: 1, packedItems: null, weightKg: 1, widthCm: 10, depthCm: 10, heightCm: 10,
      deferredAt: null, courierPickedUpAt: null, warehouseReadyAt: new Date(),
      shipment: null, reclamation: null, orderItem: null,
      order: { id: "cancelled", number: "SPC-2026-002282", status: "OTKAZANO", cancelledAt: new Date() },
    }],
  });
  const html = renderToStaticMarkup(await PickupBatchPage({ params: Promise.resolve({ id: "batch" }), searchParams: Promise.resolve({}) }));
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const create = buttons.find(button => button[2].includes("Kreiraj adresnice i pošalji"));
  const remove = buttons.find(button => button[2].includes("Ukloni otkazanu picking grupu"));
  expect(create).toBeDefined();
  expect(create![1]).toMatch(/\sdisabled(?:\s|=|$)/);
  expect(remove).toBeDefined();
  expect(remove![1]).not.toMatch(/\sdisabled(?:\s|=|$)/);
  expect(html).toContain("Otkazane porudžbine u učitanom pickingu");
  expect(html).toContain("1 paketa ostaje u nalogu");
});
