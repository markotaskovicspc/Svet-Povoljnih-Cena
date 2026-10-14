import { describe, expect, it } from "vitest";
import { ScanPress } from "../../src/lib/admin/scan-press";
describe("camera scan trigger", () => {
  it("accepts nothing until pressed and only one result per hold", () => {
    const trigger = new ScanPress();
    expect(trigger.accept()).toBe(false);
    trigger.begin();
    expect(trigger.accept()).toBe(true);
    trigger.begin(); // pointer/key repeats must not re-arm a held trigger
    expect(trigger.accept()).toBe(false);
    trigger.release(); trigger.begin();
    expect(trigger.accept()).toBe(true);
  });
  it("does not deliver late results after cancellation or leaving the app", () => {
    const trigger = new ScanPress(); trigger.begin(); trigger.release();
    expect(trigger.active).toBe(false);
    expect(trigger.accept()).toBe(false);
  });
});
