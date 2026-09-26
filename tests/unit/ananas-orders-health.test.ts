import { describe, expect, it } from "vitest";
import { ananasOrdersHealth } from "@/lib/ananas/orders-health";
const now = new Date("2026-09-26T10:30:00Z");
const success = { status: "SUCCESS", startedAt: new Date("2026-09-26T10:20:00Z"), to: new Date("2026-09-26T10:20:00Z"), finishedAt: new Date("2026-09-26T10:21:00Z") };
describe("Ananas dashboard import freshness", () => {
  it("warns when no automatic import has succeeded", () => expect(ananasOrdersHealth(null, null, now).delayed).toBe(true));
  it("accepts a recent import and a newer active run", () => {
    expect(ananasOrdersHealth(success, success, now).delayed).toBe(false);
    expect(ananasOrdersHealth({ ...success, status: "RUNNING", startedAt: new Date("2026-09-26T10:29:00Z") }, success, now).delayed).toBe(false);
  });
  it("warns for a failed or abandoned run even after a recent success", () => {
    for (const status of ["FAILED", "RUNNING"]) expect(ananasOrdersHealth({ ...success, status }, success, now).delayed).toBe(true);
  });
  it("uses the imported date window, not a recent completion of an old window", () => {
    expect(ananasOrdersHealth(success, { ...success, to: new Date("2026-09-25T20:00:00Z") }, now).delayed).toBe(true);
  });
});
