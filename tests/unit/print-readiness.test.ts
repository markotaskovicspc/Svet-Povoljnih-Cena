import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoPrintOnLoad } from "@/components/admin/auto-print-on-load";
import { renderXExpressBatchLabelsHtml } from "@/lib/x-express/labels";

const effect = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock("react", () => ({
  useEffect: (setup: () => () => void) => { effect.cleanup = setup(); },
}));

const labelHtml = () => renderXExpressBatchLabelsHtml([{
  id: "print-test", trackingNo: "AAA0850300001", packageCount: 1,
  providerParcelNumbers: ["AAA0850300001"], providerRouteCode: "BG-PA-4",
  providerRouteName: null, rawCreateResponse: null, createdAt: new Date(),
  order: {
    number: "TEST-PRINT", total: 100, paymentMethod: "UPLATA_NA_RACUN",
    shipFirstName: "Test", shipLastName: "Kupac", shipPhone: "0600000000",
    shipStreet: "Test 1", shipCity: "Beograd", shipPostalCode: "11000",
    notes: null, items: [],
  },
}], { autoPrint: true });

function browser(readyState: "loading" | "complete") {
  vi.useFakeTimers();
  let fontsReady!: () => void;
  const fonts = new Promise<void>((resolve) => { fontsReady = resolve; });
  const button = Object.assign(new EventTarget(), {
    disabled: true, textContent: "Priprema adresnica…",
  });
  const window = Object.assign(new EventTarget(), {
    print: vi.fn(), setTimeout, clearTimeout,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
    cancelAnimationFrame: clearTimeout,
  });
  const document = { readyState, fonts: { ready: fonts }, getElementById: () => button };
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  return { window, document, button, fontsReady };
}

afterEach(() => {
  effect.cleanup?.();
  effect.cleanup = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe.each(["labels", "picking"] as const)("%s print readiness", (kind) => {
  function start(context: ReturnType<typeof browser>) {
    if (kind === "picking") AutoPrintOnLoad();
    else {
      const script = labelHtml().match(/<script>([\s\S]*?)<\/script>/)?.[1];
      expect(script).toBeTruthy();
      runInNewContext(script!, context);
    }
  }

  it.each(["loading", "complete"] as const)("waits for resources and paint when initially %s", async (state) => {
    const context = browser(state);
    start(context);
    await vi.runAllTimersAsync();
    expect(context.window.print).not.toHaveBeenCalled();

    context.document.readyState = "complete";
    context.window.dispatchEvent(new Event("load"));
    await vi.runAllTimersAsync();
    expect(context.window.print).not.toHaveBeenCalled();

    context.fontsReady();
    await Promise.resolve();
    // Font readiness alone must not print in Safari's load/microtask turn.
    expect(context.window.print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(32);
    expect(context.window.print).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(context.window.print).toHaveBeenCalledTimes(1);

    if (kind === "labels") {
      expect(context.button.disabled).toBe(false);
      expect(context.button.textContent).toBe("Štampaj adresnice");
      context.button.dispatchEvent(new Event("click"));
      expect(context.window.print).toHaveBeenCalledTimes(2);
    }
  });
});

it("does not print a picking page after navigating away while fonts load", async () => {
  const context = browser("complete");
  AutoPrintOnLoad();
  effect.cleanup?.();
  context.fontsReady();
  await vi.runAllTimersAsync();
  expect(context.window.print).not.toHaveBeenCalled();
});
