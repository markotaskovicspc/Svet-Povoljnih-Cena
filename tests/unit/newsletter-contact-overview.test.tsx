import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({
  databaseIdentifier: (name: string) => Prisma.raw(`"${name}"`),
  db: { $queryRaw: mocks.query },
}));
import { getNewsletterContactOverview } from "@/lib/newsletter/contact-overview";
import { NewsletterContactOverview } from "@/components/admin/newsletter-contact-overview";

beforeEach(() => vi.clearAllMocks());

it("keeps all known addresses separate from consent and send eligibility", async () => {
  mocks.query.mockResolvedValue([{ total: BigInt(70000), activeConsent: BigInt(334), eligible: BigInt(330), legacyConsentMissingContact: BigInt(12) }]);
  const counts = await getNewsletterContactOverview();
  expect(counts).toEqual({ total: 70000, activeConsent: 334, withoutActiveConsent: 69666, eligible: 330, legacyConsentMissingContact: 12 });
  const html = renderToStaticMarkup(<NewsletterContactOverview counts={counts} />);
  expect(html).toContain("70.000");
  expect(html).toContain("69.666");
  expect(html).toContain("Svi email kontakti");
  expect(html).toContain("Sa aktivnom saglasnošću");
  expect(html).toContain("Dostupni za newsletter");
  expect(html).toContain("12 adresa ima ranije evidentiranu prijavu");
  expect(html).toContain("ove adrese još nisu uključene");
});

it("shows an empty database honestly and does not warn about missing migration", async () => {
  mocks.query.mockResolvedValue([{ total: BigInt(0), activeConsent: BigInt(0), eligible: BigInt(0), legacyConsentMissingContact: BigInt(0) }]);
  const counts = await getNewsletterContactOverview();
  expect(counts).toEqual({ total: 0, activeConsent: 0, withoutActiveConsent: 0, eligible: 0, legacyConsentMissingContact: 0 });
  const html = renderToStaticMarkup(<NewsletterContactOverview counts={counts} />);
  expect(html).not.toContain('role="status"');
  expect(html).toContain("Ista email adresa broji se jednom");
});

it("does not replace failed database reads with misleading zero contact counts", async () => {
  mocks.query.mockRejectedValue(new Error("database unavailable"));
  await expect(getNewsletterContactOverview()).rejects.toThrow("database unavailable");
});
