import { describe, expect, it } from "vitest";
import { getErpModuleDefinition } from "@/lib/admin/erp";
import {
  isPickupBatchEditable,
  nextPickupBatchNumber,
  PICKUP_BATCH_EXTERNAL_BLOCK_REASON,
  PICKUP_BATCH_STATUS_LABEL,
} from "@/lib/admin/pickup-batch";

describe("ERP module 13 pickup batches", () => {
  it("exposes the required commands and overview columns", () => {
    const definition = getErpModuleDefinition("preuzimanja");

    expect(definition).toBeDefined();
    expect(definition?.number).toBe("13");
    expect(definition?.commands.map((command) => command.label)).toEqual([
      "Novi",
      "Uredi",
      "Obriši",
      "Proknjiži",
    ]);
    expect(definition?.columns.slice(0, 3).map((column) => column.label)).toEqual([
      "Status",
      "Broj naloga",
      "Datum naloga",
    ]);
    expect(definition?.detailHrefBase).toBe("/admin/erp/preuzimanja");
  });

  it("keeps only GLS posting blocked while the local workflow is available", () => {
    const definition = getErpModuleDefinition("preuzimanja");
    const post = definition?.commands.find(
      (command) => command.label === "Proknjiži",
    );

    expect(definition?.status).toBe("blocked_external");
    expect(definition?.blockedReason).toBe(PICKUP_BATCH_EXTERNAL_BLOCK_REASON);
    expect(post?.disabledReason).toBe(PICKUP_BATCH_EXTERNAL_BLOCK_REASON);
    expect(definition?.commands.slice(0, 3).every((command) => !command.disabledReason)).toBe(
      true,
    );
  });

  it("generates the next annual number without reusing a deleted gap", () => {
    expect(
      nextPickupBatchNumber(
        ["PRE-2026-0001", "PRE-2026-0003", "PRE-2025-0099", "neispravno"],
        2026,
      ),
    ).toBe("PRE-2026-0004");
    expect(nextPickupBatchNumber([], 2027)).toBe("PRE-2027-0001");
  });

  it("allows edits only while the pickup batch is new", () => {
    expect(isPickupBatchEditable("DRAFT")).toBe(true);
    expect(isPickupBatchEditable("POSTING")).toBe(false);
    expect(isPickupBatchEditable("BOOKED")).toBe(false);
    expect(isPickupBatchEditable("PICKED_UP")).toBe(false);
    expect(isPickupBatchEditable("CANCELLED")).toBe(false);
    expect(PICKUP_BATCH_STATUS_LABEL.DRAFT).toBe("Novi");
    expect(PICKUP_BATCH_STATUS_LABEL.POSTING).toBe("Slanje kuriru");
  });
});
