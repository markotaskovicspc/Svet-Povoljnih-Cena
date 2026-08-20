import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  expandCmsVariables,
  isAllowedCmsHref,
  parseCmsHeading,
  validateCmsMarkdown,
} from "@/lib/cms/markdown";
import {
  contentPreviewPath,
  validateContentSlug,
} from "@/lib/cms/constants";
import {
  getFunctionalContentPage,
  getPublishedContentPage,
} from "@/lib/cms/pages";
import {
  FUNCTIONAL_CONTENT_PAGE_SLUGS,
  isFunctionalContentPageSlug,
  SYSTEM_CONTENT_PAGES,
} from "@/lib/cms/system-pages";
import { contentPageStatus } from "@/app/admin/sadrzaj/status";

const DATABASE_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;
const originalDatabaseEnv = Object.fromEntries(
  DATABASE_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of DATABASE_KEYS) {
    const original = originalDatabaseEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("CMS Markdown safety", () => {
  it("keeps every bundled system page publishable", () => {
    for (const page of SYSTEM_CONTENT_PAGES) {
      expect(validateCmsMarkdown(page.bodyMarkdown), page.slug).toEqual([]);
    }
  });

  it("routes reclamations exclusively through the customer portal", () => {
    const reclamationPage = SYSTEM_CONTENT_PAGES.find(
      (page) => page.slug === "reklamacije",
    );

    expect(reclamationPage?.bodyMarkdown).toContain(
      "[Moj nalog → Reklamacije](/nalog/reklamacije)",
    );
    expect(reclamationPage?.bodyMarkdown).not.toContain("mailto:");
    expect(reclamationPage?.bodyMarkdown).not.toContain(
      "reklamacije@svetpovoljnihcena.rs",
    );
  });

  it("registers every functional public page as editable CMS content", () => {
    expect([...FUNCTIONAL_CONTENT_PAGE_SLUGS].sort()).toEqual([
      "komentari",
      "kontakt",
      "podesavanja-kolacica",
      "servis",
    ]);
    for (const slug of FUNCTIONAL_CONTENT_PAGE_SLUGS) {
      expect(isFunctionalContentPageSlug(slug)).toBe(true);
      expect(SYSTEM_CONTENT_PAGES.find((page) => page.slug === slug)).toMatchObject({
        functional: true,
      });
    }
  });

  it("accepts supported content, stable anchors and safe links", () => {
    const markdown = `## Načini plaćanja {#kartice}

**Važno:** pogledajte [uslove](/uslovi-kupovine), [podršku](mailto:podrska@example.com) i [partnera](https://example.com).

| Način | Rok |
| --- | --- |
| Kartica | Odmah |`;

    expect(validateCmsMarkdown(markdown)).toEqual([]);
    expect(parseCmsHeading("## Načini plaćanja {#kartice}")).toEqual({
      depth: 2,
      label: "Načini plaćanja",
      explicitId: "kartice",
      id: "kartice",
    });
  });

  it("blocks duplicate or invalid heading anchors", () => {
    const duplicate = validateCmsMarkdown(
      "## Prva {#ista}\n\n## Druga {#ista}",
    );
    const invalid = validateCmsMarkdown("## Naslov {#Nije_dozvoljeno}");

    expect(duplicate.map((issue) => issue.code)).toContain("duplicate_anchor");
    expect(invalid.map((issue) => issue.code)).toContain("anchor");
  });

  it("blocks raw HTML, images, H1 headings and unsafe links", () => {
    const issues = validateCmsMarkdown(`# Glavni naslov

<script>alert(1)</script>

![slika](https://example.com/a.jpg)

[napad](javascript:alert(1))`);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["h1", "raw_html", "image", "link"]),
    );
    expect(
      validateCmsMarkdown("[napad][x]\n\n[x]: javascript:alert(1)").map(
        (issue) => issue.code,
      ),
    ).toContain("link");
    expect(
      validateCmsMarkdown("![slika][x]\n\n[x]: https://example.com/a.jpg").map(
        (issue) => issue.code,
      ),
    ).toContain("image");
  });

  it("allows only internal, https, mailto, tel and anchor destinations", () => {
    expect(isAllowedCmsHref("/pomoc#isporuka")).toBe(true);
    expect(isAllowedCmsHref("https://example.com")).toBe(true);
    expect(isAllowedCmsHref("mailto:info@example.com")).toBe(true);
    expect(isAllowedCmsHref("tel:+38111222333")).toBe(true);
    expect(isAllowedCmsHref("#kartice")).toBe(true);
    expect(validateCmsMarkdown("<https://example.com>")).toEqual([]);
    expect(isAllowedCmsHref("//evil.example")).toBe(false);
    expect(isAllowedCmsHref("http://example.com")).toBe(false);
    expect(isAllowedCmsHref("javascript:alert(1)")).toBe(false);
  });

  it("expands controlled legal variables and rejects unknown ones", () => {
    const expanded = expandCmsVariables(
      "{{merchant.name}} · {{merchant.pib}} · {{merchant.email}}",
    );
    expect(expanded).not.toContain("{{merchant.");
    expect(validateCmsMarkdown("Tekst {{merchant.unknown}}")[0]?.code).toBe(
      "variable",
    );
  });
});

describe("CMS page slugs", () => {
  it("rejects application and system routes for custom pages", () => {
    expect(validateContentSlug("admin")).toContain("rezervisan");
    expect(validateContentSlug("uslovi-kupovine")).toContain("rezervisan");
    expect(validateContentSlug("p")).toContain("između");
  });

  it("accepts a custom slug and permits a known system slug in system mode", () => {
    expect(validateContentSlug("vodic-za-kupovinu")).toBeNull();
    expect(
      validateContentSlug("uslovi-kupovine", { allowSystemSlug: true }),
    ).toBeNull();
  });

  it("builds a live preview path using the server slug normalization", () => {
    expect(contentPreviewPath("  Novi-Vodic  ")).toBe("/novi-vodic");
    expect(contentPreviewPath("   ")).toBe("/slug");
  });
});

describe("CMS publication state", () => {
  it("keeps the system-page fallback available without a database", async () => {
    for (const key of DATABASE_KEYS) delete process.env[key];

    const page = await getPublishedContentPage("o-nama");

    expect(page).toMatchObject({
      id: null,
      slug: "o-nama",
      kind: "SYSTEM",
      title: "Pošten nameštaj, poštena cena.",
    });
  });

  it("keeps functional pages available without a CMS row", async () => {
    for (const key of DATABASE_KEYS) delete process.env[key];

    const page = await getFunctionalContentPage("kontakt");

    expect(page).toMatchObject({
      id: null,
      slug: "kontakt",
      kind: "SYSTEM",
      title: "Razgovarajmo.",
    });
  });

  it("distinguishes drafts, published changes and archived pages", () => {
    expect(
      contentPageStatus({
        archivedAt: null,
        published: false,
        draftRevisionId: "draft",
        publishedRevisionId: null,
      }),
    ).toBe("Nacrt");
    expect(
      contentPageStatus({
        archivedAt: null,
        published: true,
        draftRevisionId: "draft-2",
        publishedRevisionId: "published-1",
      }),
    ).toBe("Objavljeno sa neobjavljenim izmenama");
    expect(
      contentPageStatus({
        archivedAt: new Date(),
        published: false,
        draftRevisionId: "draft",
        publishedRevisionId: "published",
      }),
    ).toBe("Arhivirano");
  });

  it("migrates old rows into immutable revisions and keeps custom rows unpublished", async () => {
    const migration = await readFile(
      path.join(
        process.cwd(),
        "prisma/migrations/0035_content_pages_cms/migration.sql",
      ),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "ContentPageRevision"');
    expect(migration).toContain('INSERT INTO "ContentPageRevision"');
    expect(migration).toContain(
      'WHEN "published" AND "kind" = \'SYSTEM\' THEN "id" || \'-revision-1\'',
    );
    expect(migration).toContain(
      '"published" = "published" AND "kind" = \'SYSTEM\'',
    );
  });
});
