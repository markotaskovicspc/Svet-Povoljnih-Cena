import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/app/admin/erp/preuzimanja/[id]/picking/actions", () => ({ recordPicking: vi.fn(), finishPicking: vi.fn() }));
import { DigitalPicking } from "@/components/admin/digital-picking";
type Session = Parameters<typeof DigitalPicking>[0]["initial"];
it("offers a single explicit packing-and-send action, with no separate packing checkbox", () => {
  const session = { id: "batch", number: "PRE-1", planHash: "a".repeat(64), labelsReady: false, labelsPreparationAllowed: true,
    editable: true, cancelledOrders: [], progress: { row: 1 }, reviewedRows: ["row"], events: [], previousPlan: false, volume: null,
    rows: [{ key: "row", sku: "001", name: "Chair", quantity: 1, positions: [], warehouseName: "DC", barcode: "001", allocations: [] }],
  } as unknown as Session;
  const html = renderToStaticMarkup(<DigitalPicking initial={session} warehouseMode />);
  expect(html).toContain("Sve je spakovano — pošalji kuriru");
  expect(html).not.toContain('type="checkbox"');
  expect(html).not.toContain("Potvrđujem da su svi paketi");
});
