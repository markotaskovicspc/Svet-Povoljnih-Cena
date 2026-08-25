import { describe, expect, it } from "vitest";
import { getErpModuleDefinition } from "@/lib/admin/erp";
import {
  isPickupBatchEditable,
  formatBelgradeDateTimeLocal,
  nextPickupBatchNumber,
  parseBelgradeDateTimeLocal,
  PICKUP_BATCH_EXTERNAL_BLOCK_REASON,
  PICKUP_BATCH_STATUS_LABEL,
  pickupPostingBlockReason,
  validateMyGlsPickupWindow,
  validateXExpressPickupWindow,
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
    expect(definition?.commands[0]?.fields?.[0]).toMatchObject({
      key: "provider",
      options: ["X_EXPRESS", "MYGLS"],
      required: true,
    });
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

  it("explains every reason why posting is unavailable in workflow order", () => {
    const readyXExpress = {
      provider: "X_EXPRESS" as const,
      rowCount: 1,
      pickupStartSet: true,
      pickupEndSet: true,
      completePackageCount: 1,
    };

    expect(
      pickupPostingBlockReason({
        ...readyXExpress,
        configurationIssue: "Prethodni pokušaj nije uspeo.",
        providerReason: "Kurir nije konfigurisan.",
      }),
    ).toBe("Prethodni pokušaj nije uspeo.");
    expect(
      pickupPostingBlockReason({
        ...readyXExpress,
        providerReason: "Kurir nije konfigurisan.",
      }),
    ).toBe("Kurir nije konfigurisan.");
    expect(
      pickupPostingBlockReason({ ...readyXExpress, rowCount: 0 }),
    ).toContain("Učitajte bar jednu");
    expect(
      pickupPostingBlockReason({ ...readyXExpress, pickupStartSet: false }),
    ).toContain("sačuvajte termin");
    expect(
      pickupPostingBlockReason({ ...readyXExpress, completePackageCount: 0 }),
    ).toContain("stvarnu težinu");
    expect(pickupPostingBlockReason(readyXExpress)).toBeNull();

    const readyMyGls = {
      ...readyXExpress,
      provider: "MYGLS" as const,
      completePackageCount: 1,
    };
    expect(
      pickupPostingBlockReason({ ...readyMyGls, pickupEndSet: false }),
    ).toContain("kompletan vremenski prozor");
    expect(
      pickupPostingBlockReason({ ...readyMyGls, completePackageCount: 0 }),
    ).toContain("stvarnu težinu");
    expect(
      pickupPostingBlockReason({ ...readyMyGls, invalidPackageCount: 1 }),
    ).toContain("prelazi dozvoljenu");
    expect(pickupPostingBlockReason(readyMyGls)).toBeNull();
  });

  it("enforces X Express one-hour pickup notice", () => {
    const now = new Date("2026-08-21T06:00:00.000Z");
    expect(() =>
      validateXExpressPickupWindow(
        new Date("2026-08-21T07:00:00.000Z"),
        new Date("2026-08-21T08:00:00.000Z"),
        now,
      ),
    ).not.toThrow();
    expect(() =>
      validateXExpressPickupWindow(
        new Date("2026-08-21T06:59:59.000Z"),
        new Date("2026-08-21T08:00:00.000Z"),
        now,
      ),
    ).toThrow("najmanje 1 sat");
  });

  it("parses the Belgrade wall clock and enforces the 24h/2h MyGLS window", () => {
    const start = parseBelgradeDateTimeLocal("2026-07-31T14:00");
    const end = parseBelgradeDateTimeLocal("2026-07-31T16:00");

    expect(start.toISOString()).toBe("2026-07-31T12:00:00.000Z");
    expect(formatBelgradeDateTimeLocal(start)).toBe("2026-07-31T14:00");
    expect(() =>
      validateMyGlsPickupWindow(
        start,
        end,
        new Date("2026-07-30T11:59:59.000Z"),
      ),
    ).not.toThrow();
    expect(() =>
      validateMyGlsPickupWindow(
        start,
        end,
        new Date("2026-07-30T12:00:01.000Z"),
      ),
    ).toThrow("najmanje 24 sata");
    expect(() =>
      validateMyGlsPickupWindow(
        start,
        new Date("2026-07-31T13:59:59.000Z"),
        new Date("2026-07-30T10:00:00.000Z"),
      ),
    ).toThrow("najmanje 2 sata");
  });
});
