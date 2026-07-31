import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

describe("robots policy", () => {
  it("throttles ClaudeBot without blocking product discovery", () => {
    const policy = robots();
    expect(Array.isArray(policy.rules)).toBe(true);
    const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
    const claude = rules.find((rule) => rule.userAgent === "ClaudeBot");

    expect(claude).toMatchObject({
      allow: "/",
      crawlDelay: 1,
    });
    expect(claude?.disallow).toContain("/api");
    expect(claude?.disallow).not.toContain("/p");
  });

  it("keeps private and transactional routes hidden from all crawlers", () => {
    const policy = robots();
    const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
    const wildcard = rules.find((rule) => rule.userAgent === "*");

    expect(wildcard?.disallow).toEqual(
      expect.arrayContaining(["/admin", "/api", "/checkout", "/nalog", "/korpa"]),
    );
  });
});
