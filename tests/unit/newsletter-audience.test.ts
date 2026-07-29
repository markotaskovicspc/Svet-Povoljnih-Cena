import { describe, expect, it } from "vitest";
import {
  emptyAudienceFilter,
  matchesAudienceFilter,
  type AudienceProfile,
} from "@/lib/newsletter/audience";

const profile: AudienceProfile = {
  contactId: "contact-1",
  email: "ana@example.com",
  firstName: "Ana",
  lastName: "Anić",
  language: "sr-Latn",
  source: "footer",
  subscribedAt: new Date("2026-01-15T10:00:00Z"),
  registered: true,
  cities: ["Beograd"],
  orderCount: 3,
  totalSpend: 24_500,
  lastPurchaseAt: new Date("2026-07-10T12:00:00Z"),
  purchasedSkus: ["SKU-1", "SKU-2"],
  purchasedCategories: ["rasveta/plafonjere"],
  vouchers: ["LETO10"],
  openedCampaignIds: ["campaign-opened"],
  clickedCampaignIds: ["campaign-clicked"],
  receivedCampaignIds: ["campaign-old"],
};

describe("newsletter audience matcher", () => {
  it("includes every active profile when no rules are configured", () => {
    expect(matchesAudienceFilter(profile, emptyAudienceFilter())).toBe(true);
  });

  it("combines rules and groups with AND/OR", () => {
    expect(matchesAudienceFilter(profile, {
      logic: "AND",
      manualContactIds: [],
      excludeCampaignIds: [],
      groups: [
        {
          id: "purchase",
          logic: "AND",
          rules: [
            { id: "count", field: "orderCount", operator: "gte", value: 2 },
            { id: "city", field: "city", operator: "contains", value: "beo" },
          ],
        },
        {
          id: "engagement",
          logic: "OR",
          rules: [
            { id: "open", field: "openedCampaign", operator: "equals", value: "campaign-opened" },
            { id: "voucher", field: "voucher", operator: "equals", value: "NOPE" },
          ],
        },
      ],
    })).toBe(true);
  });

  it("supports date, spend and boolean rules", () => {
    expect(matchesAudienceFilter(profile, {
      logic: "AND",
      manualContactIds: [],
      excludeCampaignIds: [],
      groups: [{
        id: "group",
        logic: "AND",
        rules: [
          { id: "registered", field: "registered", operator: "is_true" },
          { id: "spend", field: "totalSpend", operator: "gte", value: "20000" },
          { id: "last", field: "lastPurchaseAt", operator: "after", value: "2026-07-01" },
        ],
      }],
    })).toBe(true);
  });

  it("honors manual selection and campaign exclusions before rules", () => {
    expect(matchesAudienceFilter(profile, {
      ...emptyAudienceFilter(),
      manualContactIds: ["another-contact"],
    })).toBe(false);
    expect(matchesAudienceFilter(profile, {
      ...emptyAudienceFilter(),
      excludeCampaignIds: ["campaign-old"],
    })).toBe(false);
  });
});
