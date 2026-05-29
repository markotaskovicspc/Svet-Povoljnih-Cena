import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  HomeSectionSlotKey,
  HomeSectionSourceType,
  type ActionKind,
} from "@prisma/client";
import {
  withAdminState,
  requireAdminAction,
  type AdminActionState,
} from "@/lib/admin";
import { AdminActionForm } from "@/components/admin/action-form";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  DEFAULT_HOME_SECTION_SLOTS,
  HOME_SECTION_SLOT_LABELS,
  HOME_SECTION_SLOT_ORDER,
  LANDING_PAGE_OPTIONS,
} from "@/lib/storefront/homepage";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Početna",
  robots: { index: false, follow: false },
};

const sourceTypeLabel: Record<HomeSectionSourceType, string> = {
  ACTION: "Akcija",
  LANDING_PAGE: "Landing page",
};

const schema = z.object({
  slotKey: z.nativeEnum(HomeSectionSlotKey),
  sourceType: z.nativeEnum(HomeSectionSourceType),
  actionId: z.string().optional().nullable(),
  landingPageKey: z.string().optional().nullable(),
  titleOverride: z.string().max(80).optional().nullable(),
  productLimit: z.coerce.number().int().min(1).max(24).default(12),
  enabled: z.coerce.boolean().default(true),
});

async function saveSection(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT"], action: "homeSection.upsert", entity: "HomeSectionSlot" },
    async (_actorId, formData: FormData) => {
      const parsed = schema.safeParse({
        ...Object.fromEntries(formData),
        enabled:
          formData.get("enabled") === "on" ||
          formData.get("enabled") === "true",
      });

      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Neispravan unos.",
        };
      }

      const data = parsed.data;
      const actionId = data.sourceType === "ACTION" ? data.actionId || null : null;
      const landingPageKey =
        data.sourceType === "LANDING_PAGE" ? data.landingPageKey || null : null;

      if (data.sourceType === "ACTION" && !actionId) {
        return { ok: false as const, error: "Izaberite akciju za ovu sekciju." };
      }

      if (data.sourceType === "LANDING_PAGE" && !landingPageKey) {
        return {
          ok: false as const,
          error: "Izaberite landing page za ovu sekciju.",
        };
      }

      if (
        landingPageKey &&
        !LANDING_PAGE_OPTIONS.some((option) => option.key === landingPageKey)
      ) {
        return { ok: false as const, error: "Nepoznat landing page." };
      }

      const payload = {
        sourceType: data.sourceType,
        actionId,
        landingPageKey,
        titleOverride: data.titleOverride?.trim() || null,
        productLimit: data.productLimit,
        enabled: data.enabled,
      };

      const saved = await db.homeSectionSlot.upsert({
        where: { slotKey: data.slotKey },
        create: { slotKey: data.slotKey, ...payload },
        update: payload,
      });

      revalidatePath("/admin/pocetna");
      revalidatePath("/");

      return {
        ok: true as const,
        entityId: saved.id,
        diff: { slotKey: data.slotKey, ...payload },
        message: "Sekcija je sačuvana.",
      };
    },
  )(formData);
}

export default async function HomeAdminPage() {
  await requireAdminAction(["CONTENT"]);

  const [slots, actions] = await Promise.all([
    db.homeSectionSlot.findMany({ orderBy: { slotKey: "asc" } }),
    db.action.findMany({
      orderBy: [{ sortOrder: "asc" }, { startsAt: "desc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        kind: true,
        startsAt: true,
        endsAt: true,
      },
    }),
  ]);

  const slotsByKey = new Map(slots.map((slot) => [slot.slotKey, slot]));

  return (
    <>
      <PageHeader
        title="Početna"
        description="Redosled promo sekcija posle glavnog banera. Baneri između sekcija se biraju u admin stranici Baneri."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Početna" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-2">
        {HOME_SECTION_SLOT_ORDER.map((slotKey) => {
          const saved = slotsByKey.get(slotKey);
          const defaults = DEFAULT_HOME_SECTION_SLOTS[slotKey];
          const values = saved
            ? {
                ...saved,
                titleOverride: saved.titleOverride ?? "",
                landingPageKey: saved.landingPageKey ?? "",
                actionId: saved.actionId ?? "",
              }
            : {
                ...defaults,
                id: undefined,
                titleOverride: "",
                landingPageKey: defaults.landingPageKey ?? "",
                actionId: "",
              };

          return (
            <Card key={slotKey}>
              <CardTitle
                description="Izaberite akciju ili postojeću landing stranicu. Prazna sekcija se neće prikazati na sajtu."
              >
                {HOME_SECTION_SLOT_LABELS[slotKey]}
              </CardTitle>
              <SectionForm
                action={saveSection}
                slotKey={slotKey}
                values={values}
                actions={actions}
              />
            </Card>
          );
        })}
      </div>
    </>
  );
}

type ActionOption = {
  id: string;
  slug: string;
  name: string;
  kind: ActionKind;
  startsAt: Date;
  endsAt: Date;
};

type SectionFormValues = {
  sourceType: HomeSectionSourceType;
  actionId?: string | null;
  landingPageKey?: string | null;
  titleOverride?: string | null;
  productLimit: number;
  enabled: boolean;
};

function SectionForm({
  action,
  slotKey,
  values,
  actions,
}: {
  action: (
    state: AdminActionState,
    formData: FormData,
  ) => Promise<AdminActionState>;
  slotKey: HomeSectionSlotKey;
  values: SectionFormValues;
  actions: ActionOption[];
}) {
  return (
    <AdminActionForm action={action} className="space-y-4">
      <input type="hidden" name="slotKey" value={slotKey} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tip izvora">
          <select
            name="sourceType"
            defaultValue={values.sourceType}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            {Object.values(HomeSectionSourceType).map((sourceType) => (
              <option key={sourceType} value={sourceType}>
                {sourceTypeLabel[sourceType]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Broj proizvoda">
          <Input
            name="productLimit"
            type="number"
            min={1}
            max={24}
            defaultValue={values.productLimit}
          />
        </Field>
      </div>

      <Field label="Akcija">
        <select
          name="actionId"
          defaultValue={values.actionId ?? ""}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">— Izaberite akciju —</option>
          {actions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} /{item.slug} ({item.kind})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Landing page">
        <select
          name="landingPageKey"
          defaultValue={values.landingPageKey ?? ""}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">— Izaberite landing page —</option>
          {LANDING_PAGE_OPTIONS.map((page) => (
            <option key={page.key} value={page.key}>
              {page.label} ({page.href})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Naslov sekcije (opciono)">
        <Input
          name="titleOverride"
          maxLength={80}
          defaultValue={values.titleOverride ?? ""}
          placeholder="Ako ostane prazno, koristi se naziv izvora"
        />
      </Field>

      <Field label="Aktivno">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={values.enabled}
            className="size-4 accent-walnut"
          />
          Prikaži ovu sekciju na početnoj
        </label>
      </Field>

      <div className="flex justify-end">
        <SubmitButton>Sačuvaj sekciju</SubmitButton>
      </div>
    </AdminActionForm>
  );
}
