import { afterEach, expect, it, vi } from "vitest";
import { captureCampaign } from "@/lib/analytics/campaign-attribution";
afterEach(() => vi.unstubAllGlobals());
it("keeps campaign and creative across a navigation without UTM and bounds values", () => {
  let saved = "";
  vi.stubGlobal("sessionStorage", { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
  vi.stubGlobal("location", { search: `?utm_source=facebook&utm_campaign=desk&utm_content=${"a".repeat(200)}` });
  expect(captureCampaign()).toMatchObject({ source: "facebook", campaign: "desk", content: "a".repeat(120) });
  vi.stubGlobal("location", { search: "" });
  expect(captureCampaign()).toMatchObject({ source: "facebook", campaign: "desk", content: "a".repeat(120) });
});
it("ignores malformed or non-string saved attribution", () => {
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("sessionStorage", { getItem: () => JSON.stringify({ source: { nested: "invalid" }, campaign: 123, content: null }) });
  expect(captureCampaign()).toEqual({ source: "direct", medium: "", campaign: "", content: "" });
  vi.stubGlobal("sessionStorage", { getItem: () => "not json" });
  expect(captureCampaign().source).toBe("direct");
});
