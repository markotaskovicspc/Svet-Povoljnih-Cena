import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActionState } from "@/lib/admin/action-state";

type FormProps = {
  action: (state: AdminActionState, data: FormData) => Promise<unknown>;
  preserveValues?: boolean;
  children: React.ReactNode;
};
const mocks = vi.hoisted(() => ({
  forms: [] as FormProps[],
  slots: vi.fn(), upsert: vi.fn(), category: vi.fn(), landing: vi.fn(),
  publishedLanding: vi.fn(), updateTag: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  updateTag: mocks.updateTag, revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/db", () => ({
  hasDatabaseConnection: () => true,
  db: {
    homeSectionSlot: { findMany: mocks.slots, upsert: mocks.upsert },
    action: { findMany: async () => [] },
    category: {
      findUnique: mocks.category,
      findMany: async () => [{ id: "koferi", name: "Koferi", path: "/moda-putovanja/koferi" }],
    },
    landingPage: {
      findUnique: mocks.landing,
      findMany: async () => [{ id: "koferi", title: "Koferi", slug: "koferi", status: "PUBLISHED" }],
    },
  },
}));
vi.mock("@/lib/storefront/landing-pages", () => ({ getLandingPageForStorefrontById: mocks.publishedLanding }));
vi.mock("@/lib/admin", () => ({
  requireAdminAction: async () => {},
  withAdminState: (_options: unknown, handler: (actor: string, data: FormData) => Promise<unknown>) =>
    (data: FormData) => handler("test-admin", data),
}));
vi.mock("@/components/admin/action-form", () => ({
  AdminActionForm: (props: FormProps) => {
    mocks.forms.push(props);
    return <form>{props.children}</form>;
  },
}));

import HomeAdminPage from "@/app/admin/pocetna/page";

beforeEach(() => {
  mocks.forms.length = 0;
  mocks.slots.mockResolvedValue([{
    id: "second", slotKey: "SECOND", sourceType: "LANDING_PAGE",
    landingPageKey: "landing:koferi", productLimit: 12, enabled: true,
  }]);
  mocks.category.mockResolvedValue({ id: "koferi" });
  mocks.landing.mockResolvedValue({ id: "koferi", archivedAt: null });
  mocks.publishedLanding.mockResolvedValue({ id: "koferi" });
  mocks.upsert.mockResolvedValue({ id: "second" });
});

async function render() {
  return renderToStaticMarkup(await HomeAdminPage());
}
async function save(key: string) {
  await render();
  const form = new FormData();
  for (const [name, value] of Object.entries({
    slotKey: "SECOND", sourceType: "LANDING_PAGE", landingPageKey: key,
    productLimit: "12", titleOverride: "Koferi", enabled: "on",
  })) form.set(name, value);
  return mocks.forms[1].action({ ok: false, message: "" }, form);
}

describe("homepage source selection", () => {
  it("protects every promo form from React's post-submit reset to its old defaults", async () => {
    await render();
    expect(mocks.forms).toHaveLength(6);
    expect(mocks.forms.every((form) => form.preserveValues)).toBe(true);
  });

  it("saves the category identifier even when a landing page has the same name and id", async () => {
    expect(await save("category:koferi")).toMatchObject({ ok: true });
    const { update } = mocks.upsert.mock.calls[0][0];
    expect(update).toMatchObject({ landingPageKey: "category:koferi", productLimit: 12 });
    expect(mocks.landing).not.toHaveBeenCalled();
    expect(mocks.updateTag).toHaveBeenCalledWith("storefront-home");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    mocks.slots.mockResolvedValue([{ id: "second", slotKey: "SECOND", ...update }]);
    expect(await render()).toContain('value="category:koferi" selected=""');
  });

  it("keeps an explicitly selected published landing page as a landing source", async () => {
    expect(await save("landing:koferi")).toMatchObject({ ok: true });
    expect(mocks.upsert.mock.calls[0][0].update.landingPageKey).toBe("landing:koferi");
    expect(mocks.category).not.toHaveBeenCalled();
    expect(mocks.publishedLanding).toHaveBeenCalledWith("koferi");
  });

  it("rejects a removed category without falling back to a same-named landing page", async () => {
    mocks.category.mockResolvedValue(null);
    expect(await save("category:koferi")).toMatchObject({ ok: false });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.landing).not.toHaveBeenCalled();
  });
});
