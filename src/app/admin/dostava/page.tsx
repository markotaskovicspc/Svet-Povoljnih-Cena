import { db } from "@/lib/db";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { DeliveryScope } from "@prisma/client";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { syncXExpressDictionaries } from "@/lib/x-express/sync";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import {
  MYGLS_PROVIDER,
  syncMyGlsMasterData,
} from "@/lib/mygls";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { DataTable } from "@/components/admin/data-table";
import { AdminActionForm } from "@/components/admin/action-form";
import {
  DELIVERY_WINDOWS_SETTING_KEY,
  deliveryWindowsSchema,
  getDeliveryWindows,
} from "@/lib/delivery-windows";
import {
  DELIVERY_TARIFF_SETTING_KEY,
  deliveryTariffSettingsSchema,
  getDeliveryTariffSettings,
  type DeliveryTariffSettings,
} from "@/lib/delivery-tariff-settings";
import { getPickupPostingAvailability } from "@/lib/admin/pickup-batch.server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pravila dostave",
  robots: { index: false, follow: false },
};

const optionalDeliveryPriceSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? null : value,
  z.coerce.number().nonnegative().nullable().optional(),
);

const ruleSchema = z
  .object({
    id: z.string().optional().nullable(),
    scope: z.nativeEnum(DeliveryScope).default("GLOBAL"),
    categoryId: z.string().optional().nullable(),
    productId: z.string().optional().nullable(),
    cityId: z.string().optional().nullable(),
    courierPrice: optionalDeliveryPriceSchema,
    truckPrice: optionalDeliveryPriceSchema,
    assemblyPrice: optionalDeliveryPriceSchema,
  })
  .superRefine((value, context) => {
    if (value.scope === "CATEGORY" && !value.categoryId) {
      context.addIssue({
        code: "custom",
        path: ["categoryId"],
        message: "Izaberite kategoriju.",
      });
    }
    if (value.scope === "PRODUCT" && !value.productId) {
      context.addIssue({
        code: "custom",
        path: ["productId"],
        message: "Unesite ID proizvoda.",
      });
    }
    if (
      value.courierPrice == null &&
      value.truckPrice == null &&
      value.assemblyPrice == null
    ) {
      context.addIssue({
        code: "custom",
        path: ["truckPrice"],
        message: "Unesite najmanje jednu cenu.",
      });
    }
  });

const citySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Unesite naziv grada.")
    .max(120, "Naziv grada je predugačak."),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "Poštanski broj mora imati 5 cifara."),
  truckEnabled: z.boolean(),
});

async function updateDeliveryWindows(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["OPS"],
      action: "delivery.windows.update",
      entity: "AdminSetting",
    },
    async (actorId, actionData: FormData) => {
      const parsed = deliveryWindowsSchema.safeParse({
        dc: {
          min: actionData.get("dcMin"),
          max: actionData.get("dcMax"),
        },
        supplier: {
          min: actionData.get("supplierMin"),
          max: actionData.get("supplierMax"),
        },
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Rokovi nisu ispravni.",
        };
      }
      await db.adminSetting.upsert({
        where: { key: DELIVERY_WINDOWS_SETTING_KEY },
        create: {
          key: DELIVERY_WINDOWS_SETTING_KEY,
          value: parsed.data,
          updatedBy: actorId,
        },
        update: { value: parsed.data, updatedBy: actorId },
      });
      updateTag(DELIVERY_WINDOWS_SETTING_KEY);
      updateTag("catalog-products");
      revalidatePath("/admin/dostava");
      return {
        ok: true as const,
        entityId: DELIVERY_WINDOWS_SETTING_KEY,
        diff: parsed.data,
        message: "Globalni rokovi isporuke su sačuvani.",
      };
    },
  )(formData);
}

async function updateDeliveryTariff(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["OPS"],
      action: "delivery.tariff.update",
      entity: "AdminSetting",
    },
    async (actorId, actionData: FormData) => {
      const parsed = deliveryTariffSettingsSchema.safeParse({
        category1: tariffCategoryFormValues(actionData, "category1"),
        category2: tariffCategoryFormValues(actionData, "category2"),
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error:
            parsed.error.issues[0]?.message ??
            "Cene kurirske dostave nisu ispravne.",
        };
      }

      await db.adminSetting.upsert({
        where: { key: DELIVERY_TARIFF_SETTING_KEY },
        create: {
          key: DELIVERY_TARIFF_SETTING_KEY,
          value: parsed.data,
          updatedBy: actorId,
        },
        update: { value: parsed.data, updatedBy: actorId },
      });
      updateTag(DELIVERY_TARIFF_SETTING_KEY);
      revalidatePath("/admin/dostava");
      revalidatePath("/checkout/podaci");
      return {
        ok: true as const,
        entityId: DELIVERY_TARIFF_SETTING_KEY,
        diff: parsed.data,
        message: "Kurirski cenovnik je sačuvan.",
      };
    },
  )(formData);
}

function tariffCategoryFormValues(
  formData: FormData,
  prefix: "category1" | "category2",
) {
  return {
    upTo5Kg: formData.get(`${prefix}UpTo5Kg`),
    upTo10Kg: formData.get(`${prefix}UpTo10Kg`),
    upTo20Kg: formData.get(`${prefix}UpTo20Kg`),
    upTo30Kg: formData.get(`${prefix}UpTo30Kg`),
    upTo50Kg: formData.get(`${prefix}UpTo50Kg`),
  };
}

async function upsertRule(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "delivery.upsert", entity: "DeliveryPriceRule" },
    async (_a, formData: FormData) => {
        const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
        if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        const d = parsed.data;
        const data = {
          scope: d.scope,
          categoryId: d.scope === "CATEGORY" ? (d.categoryId || null) : null,
          productId: d.scope === "PRODUCT" ? (d.productId || null) : null,
          cityId: d.cityId || null,
          courierPrice: d.courierPrice ?? null,
          truckPrice: d.truckPrice ?? null,
          assemblyPrice: d.assemblyPrice ?? null,
        };
        const existing = d.id
          ? null
          : await db.deliveryPriceRule.findFirst({
              where: {
                scope: data.scope,
                categoryId: data.categoryId,
                productId: data.productId,
                cityId: data.cityId,
              },
              orderBy: { updatedAt: "desc" },
              select: { id: true },
            });
        const ruleId = d.id ?? existing?.id;
        const saved = ruleId
          ? await db.deliveryPriceRule.update({ where: { id: ruleId }, data })
          : await db.deliveryPriceRule.create({ data });
        revalidatePath("/admin/dostava");
        revalidatePath("/checkout/podaci");
        return {
          ok: true as const,
          entityId: saved.id,
          diff: data,
          message: "Cena dostave je sačuvana.",
        };
      },
  )(formData);
}

async function createCity(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    {
      allowed: ["OPS"],
      action: "delivery.city.create",
      entity: "DeliveryCity",
    },
    async (_actorId, actionData: FormData) => {
      const parsed = citySchema.safeParse({
        name: actionData.get("name"),
        postalCode: actionData.get("postalCode"),
        truckEnabled: actionData.get("truckEnabled") === "1",
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error:
            parsed.error.issues[0]?.message ??
            "Podaci o gradu nisu ispravni.",
        };
      }

      const duplicate = await db.deliveryCity.findFirst({
        where: { name: { equals: parsed.data.name, mode: "insensitive" } },
        select: { id: true },
      });
      if (duplicate) {
        return {
          ok: false as const,
          error:
            "Grad već postoji. Dostupnost kamiona promenite u tabeli ispod.",
        };
      }

      const city = await db.deliveryCity.create({ data: parsed.data });
      revalidatePath("/admin/dostava");
      revalidatePath("/checkout/podaci");
      return {
        ok: true as const,
        entityId: city.id,
        diff: parsed.data,
        message: "Grad je dodat u pravila dostave.",
      };
    },
  )(formData);
}

async function removeRule(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["OPS"], action: "delivery.delete", entity: "DeliveryPriceRule" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.deliveryPriceRule.delete({ where: { id } });
        revalidatePath("/admin/dostava");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

async function toggleTruck(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "city.toggleTruck", entity: "DeliveryCity" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        const enabled = formData.get("enabled") === "1";
        await db.deliveryCity.update({ where: { id }, data: { truckEnabled: enabled } });
        revalidatePath("/admin/dostava");
        revalidatePath("/checkout/podaci");
        return {
          ok: true as const,
          entityId: id,
          diff: { truckEnabled: enabled },
          message: "Dostupnost kamiona je promenjena.",
        };
      },
  )(formData);
}

async function syncXExpressDictionariesAction() {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "delivery.xExpressDictionarySync", entity: "CourierSyncRun" },
    async () => {
      const result = await syncXExpressDictionaries();
      revalidatePath("/admin/dostava");
      return { ok: true as const, diff: result, message: "X Express šifarnici su osveženi." };
    },
  )();
}

async function syncMyGlsMasterDataAction() {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "delivery.myGlsMasterDataSync", entity: "CourierSyncRun" },
    async () => {
      const result = await syncMyGlsMasterData();
      revalidatePath("/admin/dostava");
      return { ok: true as const, diff: result, message: "MyGLS šifarnici su osveženi." };
    },
  )();
}

export default async function DeliveryPage() {
  await requireAdminAction(["OPS"]);
  const [
    rules,
    cities,
    categories,
    xTowns,
    xStreets,
    xStatuses,
    xRuns,
    glsDeliveryPoints,
    glsLocations,
    glsRuns,
    xExpressReadiness,
    myGlsReadiness,
  ] = await Promise.all([
    db.deliveryPriceRule.findMany({
      orderBy: [{ scope: "asc" }, { updatedAt: "desc" }],
      include: {
        category: { select: { name: true, path: true } },
        product: { select: { sku: true, name: true } },
        city: { select: { name: true } },
      },
    }),
    db.deliveryCity.findMany({ orderBy: { name: "asc" } }),
    db.category.findMany({ orderBy: { path: "asc" }, select: { id: true, name: true, path: true } }),
    db.xExpressTown.count({ where: { active: true } }),
    db.xExpressStreet.count({ where: { active: true, deleted: false } }),
    db.courierStatusCode.count({
      where: { provider: X_EXPRESS_PROVIDER, active: true },
    }),
    db.courierSyncRun.findMany({
      where: { provider: X_EXPRESS_PROVIDER },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
    db.courierDeliveryPoint.count({
      where: { provider: MYGLS_PROVIDER, active: true },
    }),
    db.courierLocationCode.count({
      where: { provider: MYGLS_PROVIDER, active: true },
    }),
    db.courierSyncRun.findMany({
      where: { provider: MYGLS_PROVIDER },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
    getPickupPostingAvailability("X_EXPRESS"),
    getPickupPostingAvailability("MYGLS"),
  ]);
  const [deliveryWindows, deliveryTariffSettings] = await Promise.all([
    getDeliveryWindows(),
    getDeliveryTariffSettings(),
  ]);

  return (
    <>
      <PageHeader
        title="Pravila dostave"
        description="Tarife dostave i rokovi — globalno, po kategoriji, po proizvodu i po gradu. Montaža je isključena pri lansiranju."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Dostava" }]}
      />
      <div className="space-y-6 px-8 py-6">
        <Card>
          <CardTitle description="Rok se bira prema izvoru robe. Artikal iz DC-a koristi DC rok; odobrena sveža dobavljačka zaliha koristi dobavljački rok.">
            Globalni rokovi isporuke
          </CardTitle>
          <AdminActionForm
            action={updateDeliveryWindows}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <Field label="DC od (dana)">
              <Input name="dcMin" type="number" min={0} max={60} required defaultValue={deliveryWindows.dc.min} />
            </Field>
            <Field label="DC do (dana)">
              <Input name="dcMax" type="number" min={0} max={60} required defaultValue={deliveryWindows.dc.max} />
            </Field>
            <Field label="Dobavljač od (dana)">
              <Input name="supplierMin" type="number" min={0} max={60} required defaultValue={deliveryWindows.supplier.min} />
            </Field>
            <Field label="Dobavljač do (dana)">
              <Input name="supplierMax" type="number" min={0} max={60} required defaultValue={deliveryWindows.supplier.max} />
            </Field>
            <SubmitButton pendingLabel="Čuvanje…">Sačuvaj rokove</SubmitButton>
          </AdminActionForm>
          <p className="mt-3 text-xs text-ink-500">
            Kupcu se prikazuje samo rok isporuke, bez oznake dobavljača i bez tačne dobavljačke količine.
          </p>
        </Card>
        <Card>
          <CardTitle description="Ove cene checkout primenjuje po zbirnoj težini svake kategorije. Izmena važi odmah nakon čuvanja.">
            Kurirski cenovnik
          </CardTitle>
          <AdminActionForm action={updateDeliveryTariff} className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <DeliveryTariffCategoryFields
                category={1}
                values={deliveryTariffSettings.category1}
              />
              <DeliveryTariffCategoryFields
                category={2}
                values={deliveryTariffSettings.category2}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <SubmitButton pendingLabel="Čuvanje…">
                Sačuvaj kurirske cene
              </SubmitButton>
            </div>
          </AdminActionForm>
          <p className="mt-3 text-xs text-ink-500">
            Preko 50 kg checkout koristi kamionsku dostavu. Njenu cenu menjate
            pravilom GLOBAL / Svi gradovi u odeljku ispod.
          </p>
        </Card>
        <Card>
          <CardTitle description="Obe službe su u upotrebi; kurir se određuje iz težine i dimenzija svakog fizičkog paketa.">
            Automatski izbor kurira
          </CardTitle>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <p className="font-semibold">X Express</p>
              <p className="mt-1 text-ink-600">Paket je do 30 kg i svaka strana je do 60 cm.</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="font-semibold">MyGLS</p>
              <p className="mt-1 text-ink-600">Paket je preko 30 kg ili je bar jedna strana preko 60 cm, uz MyGLS ograničenja.</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-500">
            Nepotpune mere ili težina, prekoračena ograničenja i porudžbine koje mešaju oba kurira ne šalju se automatski.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
          <Card className="p-0">
            <DataTable
              columns={[
                { key: "scope", label: "Opseg" },
                { key: "target", label: "Cilj" },
                { key: "city", label: "Grad" },
                { key: "courier", label: "Kurir", align: "right" },
                { key: "truck", label: "Kamion", align: "right" },
                { key: "assembly", label: "Montaža", align: "right" },
                { key: "actions", label: "" },
              ]}
              rows={rules.map((r) => ({
                id: r.id,
                cells: {
                  scope: r.scope,
                  target:
                    r.scope === "CATEGORY"
                      ? (r.category?.path ?? "—")
                      : r.scope === "PRODUCT"
                        ? `${r.product?.sku ?? "—"}`
                        : "—",
                  city: r.city?.name ?? "Svi",
                  courier:
                    r.courierPrice != null
                      ? formatRsd(num(r.courierPrice))
                      : "—",
                  truck:
                    r.truckPrice != null
                      ? formatRsd(num(r.truckPrice))
                      : "—",
                  assembly:
                    r.assemblyPrice != null
                      ? formatRsd(num(r.assemblyPrice))
                      : "—",
                  actions: (
                    <form action={removeRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                        ×
                      </SubmitButton>
                    </form>
                  ),
                },
              }))}
              empty="Nema pravila."
            />
          </Card>
          <Card>
            <CardTitle description="Ako pravilo za isti opseg, cilj i grad već postoji, njegova cena će biti promenjena.">
              Dodaj ili promeni cenu
            </CardTitle>
            <AdminActionForm action={upsertRule} className="space-y-3">
              <Field label="Opseg">
                <select
                  name="scope"
                  defaultValue="GLOBAL"
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {Object.values(DeliveryScope).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Kategorija (ako CATEGORY)">
                <select
                  name="categoryId"
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.path}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Proizvod ID (ako PRODUCT)">
                <Input name="productId" placeholder="cuid…" />
              </Field>
              <Field label="Grad (opciono)">
                <select
                  name="cityId"
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Svi gradovi</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Kurir (rezervna cena)">
                  <Input name="courierPrice" type="number" min={0} />
                </Field>
                <Field label="Kamion">
                  <Input name="truckPrice" type="number" min={0} />
                </Field>
                <Field label="Montaža">
                  <Input name="assemblyPrice" type="number" min={0} />
                </Field>
              </div>
              <div className="flex justify-end">
                <SubmitButton>Sačuvaj cenu</SubmitButton>
              </div>
            </AdminActionForm>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle
              description={`${xTowns} mesta · ${xStreets} ulica · ${xStatuses} statusa u lokalnom kešu`}
            >
              X Express šifarnici
            </CardTitle>
            <ProviderStatus label="Koristi se za pakete do 60 cm" />
            <ProviderReadiness
              ready={xExpressReadiness.available}
              reason={xExpressReadiness.reason}
              handoff="X Express je potvrdio da je prvi važeći kod AAA0850300001; kod AAA0850300000 se preskače."
            />
            <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="text-sm text-ink-700">
                <p>
                  Checkout koristi lokalno keširane X Express adrese. Osvežavanje
                  ne izlaže API kredencijale browseru.
                </p>
                <SyncRunList runs={xRuns} />
              </div>
              <AdminActionForm action={syncXExpressDictionariesAction}>
                <SubmitButton variant="outline">Osveži X Express</SubmitButton>
              </AdminActionForm>
            </div>
          </Card>

          <Card>
            <CardTitle
              description={`${glsDeliveryPoints} paket tačaka · ${glsLocations} lokacija u lokalnom kešu`}
            >
              MyGLS šifarnici
            </CardTitle>
            <ProviderStatus label="Koristi se za pakete preko 30 kg ili 60 cm" />
            <ProviderReadiness
              ready={myGlsReadiness.available}
              reason={myGlsReadiness.reason}
              handoff="Produkcijsko slanje ostaje zaključano dok ugovor, kredencijali i MYGLS_PRODUCTION_ACCEPTED nisu potvrđeni."
            />
            <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="text-sm text-ink-700">
                <p>
                  MyGLS keš sadrži paket shopove/lockere i lokacije za Srbiju.
                  Koristi se za pakete koji po težini ili dimenzijama pripadaju MyGLS-u.
                </p>
                <SyncRunList runs={glsRuns} />
              </div>
              <AdminActionForm action={syncMyGlsMasterDataAction}>
                <SubmitButton variant="outline">Osveži MyGLS</SubmitButton>
              </AdminActionForm>
            </div>
          </Card>
        </div>

        <Card>
          <CardTitle description="Dodajte grad, a zatim uključite ili isključite kamionsku isporuku bez izmene koda.">
            Gradovi za kamionsku isporuku
          </CardTitle>
          <AdminActionForm
            action={createCity}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <Field label="Grad">
              <Input
                name="name"
                placeholder="npr. Sombor"
                maxLength={120}
                required
              />
            </Field>
            <Field label="Poštanski broj">
              <Input
                name="postalCode"
                inputMode="numeric"
                pattern="[0-9]{5}"
                placeholder="25000"
                maxLength={5}
                required
              />
            </Field>
            <label className="flex h-8 items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                name="truckEnabled"
                value="1"
                className="size-4 rounded border-input"
                defaultChecked
              />
              Odmah uključi kamion
            </label>
            <SubmitButton pendingLabel="Dodavanje…">Dodaj grad</SubmitButton>
          </AdminActionForm>
          <div className="mt-5">
            <DataTable
              columns={[
                { key: "name", label: "Grad" },
                { key: "postal", label: "Poštanski" },
                { key: "truck", label: "Kamion" },
                { key: "actions", label: "" },
              ]}
              rows={cities.map((c) => ({
                id: c.id,
                cells: {
                  name: c.name,
                  postal: c.postalCode ?? "—",
                  truck: c.truckEnabled ? "✓" : "—",
                  actions: (
                    <AdminActionForm action={toggleTruck}>
                      <input type="hidden" name="id" value={c.id} />
                      <input
                        type="hidden"
                        name="enabled"
                        value={c.truckEnabled ? "0" : "1"}
                      />
                      <SubmitButton variant="outline" size="xs">
                        {c.truckEnabled ? "Isključi" : "Uključi"} kamion
                      </SubmitButton>
                    </AdminActionForm>
                  ),
                },
              }))}
              empty="Nema gradova u bazi."
            />
          </div>
        </Card>
      </div>
    </>
  );
}

function ProviderStatus({ label }: { label: string }) {
  return (
    <span
      className="mt-2 inline-flex rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700"
    >
      {label}
    </span>
  );
}

const DELIVERY_TARIFF_FIELDS = [
  { key: "upTo5Kg", suffix: "UpTo5Kg", label: "Do 5 kg" },
  { key: "upTo10Kg", suffix: "UpTo10Kg", label: "Do 10 kg" },
  { key: "upTo20Kg", suffix: "UpTo20Kg", label: "Do 20 kg" },
  { key: "upTo30Kg", suffix: "UpTo30Kg", label: "Do 30 kg" },
  { key: "upTo50Kg", suffix: "UpTo50Kg", label: "Do 50 kg" },
] as const;

function DeliveryTariffCategoryFields({
  category,
  values,
}: {
  category: 1 | 2;
  values: DeliveryTariffSettings["category1"];
}) {
  const prefix = category === 1 ? "category1" : "category2";
  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">
        Kategorija {category === 1 ? "I" : "II"}
      </legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {DELIVERY_TARIFF_FIELDS.map((field) => (
          <Field key={field.key} label={field.label}>
            <Input
              name={`${prefix}${field.suffix}`}
              type="number"
              min={0}
              max={1_000_000}
              step={1}
              defaultValue={values[field.key]}
              required
            />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}

function ProviderReadiness({
  ready,
  reason,
  handoff,
}: {
  ready: boolean;
  reason: string | null;
  handoff: string;
}) {
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${ready ? "border-success/25 bg-success/10 text-success" : "border-warning/25 bg-warning/10 text-warning"}`}>
      <p className="font-semibold">{ready ? "Spremno za kreiranje pošiljke" : "Spoljna konfiguracija nije završena"}</p>
      {!ready && reason ? <p className="mt-1">{reason}</p> : null}
      {!ready ? <p className="mt-1">{handoff}</p> : null}
    </div>
  );
}

function SyncRunList({
  runs,
}: {
  runs: Array<{
    id: string;
    startedAt: Date;
    kind: string;
    status: string;
    recordsOk: number;
    recordsRead: number;
    errorMessage: string | null;
  }>;
}) {
  if (!runs.length) {
    return <p className="mt-3 text-xs text-ink-500">Još nema sync pokušaja.</p>;
  }
  return (
    <ul className="mt-3 space-y-1 text-xs text-ink-600">
      {runs.map((run) => (
        <li key={run.id}>
          {run.startedAt.toLocaleString("sr-Latn-RS")} · {run.kind} ·{" "}
          {run.status} · {run.recordsOk}/{run.recordsRead}
          {run.errorMessage ? ` · ${run.errorMessage}` : ""}
        </li>
      ))}
    </ul>
  );
}
