import { describe, expect, it } from "vitest";
import {
  isTerminalOrderException,
  orderStatusTimeline,
} from "@/lib/order-status-timeline";

describe("public order status timeline", () => {
  it("marks every completed step through the current status", () => {
    const timeline = orderStatusTimeline("u_isporuci");

    expect(timeline.map((step) => [step.status, step.done, step.current])).toEqual([
      ["kreirano", true, false],
      ["potvrdjeno", true, false],
      ["u_pripremi", true, false],
      ["spremno_za_isporuku", true, false],
      ["u_isporuci", true, true],
      ["isporuceno", false, false],
    ]);
  });

  it("keeps the completed delivery trail visible for a returned order", () => {
    expect(orderStatusTimeline("vraceno").every((step) => step.done)).toBe(true);
    expect(isTerminalOrderException("vraceno")).toBe(true);
    expect(isTerminalOrderException("otkazano")).toBe(true);
  });

  it("does not pretend an invalidated order progressed past creation", () => {
    const timeline = orderStatusTimeline("otkazano");
    expect(timeline.filter((step) => step.done)).toHaveLength(0);
    expect(timeline.some((step) => step.current)).toBe(false);
  });
});
