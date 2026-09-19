import { describe, expect, it } from "vitest";
import { suppressionRecipients } from "@/lib/email/tracking";
describe("SES suppression addresses", () => {
  it("suppresses all affected hard-bounce recipients, not the first To address", () => {
    expect(suppressionRecipients({ mail: { destination: ["unaffected@example.com"] }, bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "BAD@example.com" }, { emailAddress: "second@example.com" }] } })).toEqual(["bad@example.com", "second@example.com"]);
  });
  it("does not permanently suppress a transient bounce", () => {
    expect(suppressionRecipients({ mail: { destination: ["full@example.com"] }, bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: "full@example.com" }] } })).toEqual([]);
  });
  it("uses the reported complaint address", () => {
    expect(suppressionRecipients({ mail: { destination: ["other@example.com"] }, complaint: { complainedRecipients: [{ emailAddress: "complaint@example.com" }] } })).toEqual(["complaint@example.com"]);
  });
});
