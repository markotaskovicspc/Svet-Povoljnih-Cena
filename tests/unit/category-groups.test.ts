import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ensureCategoryGroup } from "@/lib/category-groups.server";

describe("category groups", () => {
  it("backfills every missing category without changing product assignments", () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/0046_sync_categories_to_groups/migration.sql",
      ),
      "utf8",
    );

    expect(sql).toContain('FROM "Category" AS category');
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(sql).not.toContain('UPDATE "Product"');
  });

  it("reuses an existing group matched by slug or case-insensitive name", async () => {
    const existing = { id: "group-1", slug: "namestaj", name: "Nameštaj" };
    const tx = {
      group: {
        findFirst: vi.fn().mockResolvedValue(existing),
        upsert: vi.fn(),
      },
    };

    await expect(
      ensureCategoryGroup(tx as never, { slug: "namestaj", name: "Nameštaj" }),
    ).resolves.toEqual(existing);
    expect(tx.group.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { slug: "namestaj" },
          { name: { equals: "Nameštaj", mode: "insensitive" } },
        ],
      },
    });
    expect(tx.group.upsert).not.toHaveBeenCalled();
  });

  it("creates a missing group with the category name and slug", async () => {
    const created = {
      id: "group-2",
      slug: "kancelarijske-stolice-i-stolovi",
      name: "Kancelarijske stolice i stolovi",
    };
    const tx = {
      group: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(created),
      },
    };

    await expect(
      ensureCategoryGroup(tx as never, {
        slug: "kancelarijske-stolice-i-stolovi",
        name: "Kancelarijske stolice i stolovi",
      }),
    ).resolves.toEqual(created);
    expect(tx.group.upsert).toHaveBeenCalledWith({
      where: { slug: "kancelarijske-stolice-i-stolovi" },
      create: {
        slug: "kancelarijske-stolice-i-stolovi",
        name: "Kancelarijske stolice i stolovi",
      },
      update: {},
    });
  });
});
