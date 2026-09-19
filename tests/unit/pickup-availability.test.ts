import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ provider: vi.fn(), myGls: vi.fn(), config: vi.fn(), xExpress: vi.fn() }));
vi.mock("@/lib/courier/provider-selection", () => ({ getSelectedSmallParcelProvider: mocks.provider }));
vi.mock("@/lib/mygls/config", () => ({ getMyGlsConfig: mocks.config, requireMyGlsEnabled: mocks.myGls }));
vi.mock("@/lib/x-express/config", () => ({ requireXExpressShipmentConfig: mocks.xExpress }));
import { getPickupPostingAvailability } from "@/lib/admin/pickup-availability.server";
import { PICKUP_BATCH_EXTERNAL_BLOCK_REASON } from "@/lib/admin/pickup-batch";
beforeEach(() => { vi.resetAllMocks(); mocks.provider.mockResolvedValue("MYGLS"); mocks.config.mockReturnValue({ env: "production", enabled: false }); });
describe("lightweight pickup readiness", () => {
  it("checks explicit providers without querying the default provider setting", async () => {
    expect(await getPickupPostingAvailability(" xpress ")).toMatchObject({ available: true, provider: "X_EXPRESS" });
    expect(mocks.xExpress).toHaveBeenCalledWith(true);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("keeps the production MyGLS block", async () => {
    mocks.myGls.mockImplementation(() => { throw new Error("Disabled"); });
    expect(await getPickupPostingAvailability("MYGLS")).toMatchObject({ available: false, reason: PICKUP_BATCH_EXTERNAL_BLOCK_REASON });
  });
  it("preserves provider errors and default-provider fallback", async () => {
    mocks.config.mockReturnValue({ env: "production", enabled: true });
    mocks.myGls.mockImplementation(() => { throw new Error("Missing credentials"); });
    expect(await getPickupPostingAvailability()).toMatchObject({ available: false, reason: "Missing credentials", provider: "MYGLS" });
    expect(mocks.provider).toHaveBeenCalledOnce();
  });
});
