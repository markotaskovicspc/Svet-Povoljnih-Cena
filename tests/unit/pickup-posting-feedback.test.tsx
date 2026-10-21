import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickupPostingFeedback } from "@/components/admin/pickup-posting-feedback";

const render = (blockReason: string | null, previousIssue: string | null, showReady = false) =>
  renderToStaticMarkup(<PickupPostingFeedback reasonId="posting-reason" blockReason={blockReason} previousIssue={previousIssue} showReady={showReady} myGls={false} />);

describe("pickup posting feedback after labels exist", () => {
  it("keeps a locked-button reason visible alongside the existing label status", () => {
    const html = render("Nedostaju mere za 2 paketa.", null);
    expect(html).toContain("Nedostaju mere za 2 paketa.");
    expect(html).toContain('id="posting-reason"');
    expect(html).not.toContain("je spreman");
  });
  it("shows both the current blocker and a partial-send error without claiming retry is available", () => {
    const html = render("X Express nije konfigurisan.", "Delimično poslato: prihvaćeno 10 od 68 pošiljki.");
    expect(html).toContain("X Express nije konfigurisan.");
    expect(html).toContain("prihvaćeno 10 od 68");
    expect(html).toContain("Otklonite navedeni razlog");
    expect(html).not.toContain("je dostupno");
  });
  it("explains the safe retry when the previous error is the only issue", () => {
    const html = render(null, "Neispravan telefon.");
    expect(html).toContain("Neispravan telefon.");
    expect(html).toContain("je dostupno za bezbedno ponovno slanje");
    expect(html).toContain("neće biti duplirane");
  });
  it("only shows the initial ready notice before a handover status exists", () => {
    expect(render(null, null)).toBe("");
    expect(render(null, null, true)).toContain("X Express je spreman");
  });
});
