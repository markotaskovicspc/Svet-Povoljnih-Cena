import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  slots: vi.fn(), actions: vi.fn(), pages: vi.fn(), categories: vi.fn(),
  category: vi.fn(), landing: vi.fn(), published: vi.fn(), upsert: vi.fn(),
  authorize: vi.fn(), revalidate: vi.fn(), updateTag: vi.fn(),
  forms: [] as { action: (state: unknown, data: FormData) => Promise<unknown> }[],
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: mocks.revalidate, updateTag: mocks.updateTag,
}));
vi.mock("@/lib/db", () => ({
  hasDatabaseConnection: () => true,
  db: {
    homeSectionSlot: { findMany: mocks.slots, upsert: mocks.upsert },
    action: { findMany: mocks.actions },
    landingPage: { findMany: mocks.pages, findUnique: mocks.landing },
    category: { findMany: mocks.categories, findUnique: mocks.category },
  },
}));
vi.mock("@/lib/admin", () => ({
  requireAdminAction: mocks.authorize,
  withAdminState: (_options: unknown, callback: (actor: string, data: FormData) => unknown) =>
    (data: FormData) => callback("content-admin", data),
}));
vi.mock("@/lib/storefront/landing-pages", () => ({ getLandingPageForStorefrontById: mocks.published }));
vi.mock("@/components/admin/action-form", () => ({
  AdminActionForm: ({ action, children }: { action: typeof mocks.forms[number]["action"]; children: ReactNode }) => {
    mocks.forms.push({ action });
    return <form>{children}</form>;
  },
}));
vi.mock("@/components/admin/submit-button", () => ({
  SubmitButton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));

import HomeAdminPage from "@/app/admin/pocetna/page";

beforeEach(() => {
  mocks.forms.length = 0;
  mocks.slots.mockResolvedValue([]);
  mocks.actions.mockResolvedValue([]);
  mocks.pages.mockResolvedValue([{ id: "landing-1", title: "Izbor kofera", slug: "izbor-kofera", status: "PUBLISHED" }]);
  mocks.categories.mockResolvedValue([
    { id: "travel", name: "Putovanje", path: "/putovanje" },
    { id: "suitcases", name: "Koferi", path: "/putovanje/koferi" },
  ]);
  mocks.category.mockResolvedValue({ id: "suitcases" });
  mocks.landing.mockResolvedValue({ id: "landing-1", archivedAt: null });
  mocks.published.mockResolvedValue({ id: "landing-1" });
  mocks.upsert.mockResolvedValue({ id: "slot-1" });
});

async function save(key: string) {
  renderToStaticMarkup(await HomeAdminPage());
  const form = new FormData();
  Object.entries({ slotKey: "FIFTH", sourceType: "LANDING_PAGE", landingPageKey: key, productLimit: "8", enabled: "on" })
    .forEach(([name, value]) => form.set(name, value));
  return mocks.forms[0].action({}, form);
}

describe("homepage category selection", () => {
  it("offers parent and child hamburger pages in all six forms alongside existing destinations", async () => {
    const html = renderToStaticMarkup(await HomeAdminPage());
    expect(mocks.authorize).toHaveBeenCalledWith(["CONTENT"]);
    expect(html.match(/value="category:travel"/g)).toHaveLength(6);
    expect(html.match(/value="category:suitcases"/g)).toHaveLength(6);
    expect(html).toContain("Koferi (/k/putovanje/koferi)");
    expect(html).toContain('value="landing:landing-1"');
    expect(html).toContain('value="akcija"');
  });

  it("saves the category reference and retains it when reopening the form", async () => {
    expect(await save("category:suitcases")).toMatchObject({ ok: true });
    const saved = mocks.upsert.mock.calls[0][0].create;
    expect(saved).toMatchObject({ slotKey: "FIFTH", landingPageKey: "category:suitcases", productLimit: 8, actionId: null });
    expect(mocks.updateTag).toHaveBeenCalledWith("storefront-home");
    expect(mocks.revalidate).toHaveBeenCalledWith("/");
    mocks.slots.mockResolvedValue([{ ...saved, id: "slot-1" }]);
    expect(renderToStaticMarkup(await HomeAdminPage())).toContain('value="category:suitcases" selected=""');
  });

  it("rejects a category deleted after opening the form", async () => {
    mocks.category.mockResolvedValue(null);
    expect(await save("category:deleted")).toMatchObject({ ok: false });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each(["category:", "unknown:page"])("rejects invalid reference %s", async (key) => {
    expect(await save(key)).toMatchObject({ ok: false });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each(["akcija", "landing:landing-1"])("continues saving existing destination %s", async (key) => {
    expect(await save(key)).toMatchObject({ ok: true });
    expect(mocks.upsert).toHaveBeenCalled();
  });

  it("still rejects unpublished landing pages for enabled sections", async () => {
    mocks.published.mockResolvedValue(null);
    expect(await save("landing:landing-1")).toMatchObject({ ok: false });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
