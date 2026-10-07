import { describe, expect, it, vi } from "vitest";
import { CLARITY_PROJECT_ID, createClarityController, isClarityPageAllowed } from "@/lib/analytics/clarity-client";

function fixture() {
  const scripts: { id?: string; src?: string; async?: boolean }[] = [];
  const browser = {
    clarity: undefined as undefined | (((...args: unknown[]) => void) & { q?: unknown[][] }),
    document: {
      getElementById: (id: string) => scripts.find(script => script.id === id),
      createElement: () => ({}),
      head: { appendChild: (script: typeof scripts[number]) => scripts.push(script) },
    },
  };
  return { browser, scripts, controller: createClarityController(browser as unknown as Window) };
}

describe("Clarity consent lifecycle", () => {
  it("does not load or transmit anything before analytics consent", () => {
    const { browser, scripts, controller } = fixture();
    for (const consent of [null, "essential", "marketing"] as const) controller.sync(consent, "/");
    expect(scripts).toHaveLength(0);
    expect(browser.clarity).toBeUndefined();
  });
  it("loads the supplied project once and keeps advertising denied for analytics-only visitors", () => {
    const { browser, scripts, controller } = fixture();
    controller.sync("analytics", "/");
    controller.sync("analytics", "/p/proizvod");
    expect(scripts).toEqual([{ id: "spc-clarity", async: true, src: `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}` }]);
    expect(browser.clarity?.q).toContainEqual(["consentv2", { analytics_Storage: "granted", ad_Storage: "denied" }]);
    expect(browser.clarity?.q?.some(args => args[0] === "start")).toBe(false);
  });
  it("revokes consent and stops tracking, then resumes without a duplicate script", () => {
    const { browser, scripts, controller } = fixture();
    controller.sync("all", "/");
    const clarity = vi.fn();
    browser.clarity = clarity;
    controller.sync("essential", "/");
    expect(clarity.mock.calls).toEqual([
      ["consentv2", { analytics_Storage: "denied", ad_Storage: "denied" }], ["stop"],
    ]);
    controller.sync("analytics", "/");
    expect(clarity).toHaveBeenLastCalledWith("start");
    expect(scripts).toHaveLength(1);
  });
  it("rejects private routes even with consent and stops an existing session", () => {
    const { browser, scripts, controller } = fixture();
    for (const path of ["/admin", "/admin/erp", "/nalog/porudzbine/1", "/reklamacije/prijava", "/checkout/potvrda", "/checkout/nastavi/abc", "/ponuda/abc"]) {
      expect(isClarityPageAllowed(path)).toBe(false);
      controller.sync("all", path);
    }
    controller.sync("all", "/", "?token=private-link");
    expect(scripts).toHaveLength(0);
    controller.sync("all", "/");
    controller.sync("all", "/admin");
    expect(browser.clarity?.q).toContainEqual(["stop"]);
    expect(isClarityPageAllowed("/p/proizvod", "?utm_source=facebook")).toBe(true);
  });
  it("clears pending tracking when consent is withdrawn while the script is loading", () => {
    const { browser, controller } = fixture();
    controller.sync("analytics", "/");
    controller.sync(null, "/");
    expect(browser.clarity?.q?.slice(-2)).toEqual([
      ["consentv2", { analytics_Storage: "denied", ad_Storage: "denied" }], ["stop"],
    ]);
  });
});
