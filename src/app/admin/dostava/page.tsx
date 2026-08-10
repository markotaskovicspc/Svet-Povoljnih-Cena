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
import {
  getSelectedSmallParcelProvider,
  setSelectedSmallParcelProvider,
} from "@/lib/courier";
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

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pravila dostave",
  robots: { index: false, follow: false },
};

const ruleSchema = z.object({
  id: z.string().optional().nullable(),
  scope: z.nativeEnum(DeliveryScope).default("GLOBAL"),
  categoryId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  cityId: z.string().optional().nullable(),
  courierPrice: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  truckPrice: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  assemblyPrice: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
});

const smallParcelProviderSchema = z.enum(["MYGLS", "X_EXPRESS"]);

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

async function updateSmallParcelProvider(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["OPS"],
      action: "delivery.smallParcelProvider.update",
      entity: "AdminSetting",
    },
    async (actorId, actionData: FormData) => {
      const parsed = smallParcelProviderSchema.safeParse(
        actionData.get("provider"),
      );
      if (!parsed.success) {
        return { ok: false as const, error: "Izaberite MyGLS ili X Express." };
      }
      await setSelectedSmallParcelProvider(parsed.data, actorId);
      revalidatePath("/admin/dostava");
      revalidatePath("/admin/erp");
      revalidatePath("/admin/erp/preuzimanja");
      revalidatePath("/checkout/podaci");
      revalidatePath("/admin/erp/prodajni-nalozi");
      return {
        ok: true as const,
        entityId: "courier.smallParcelProvider",
        diff: { provider: parsed.data },
        message: `Aktivni kurir je ${parsed.data === "MYGLS" ? "MyGLS" : "X Express"}.`,
      };
    },
  )(formData);
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
        const saved = d.id
          ? await db.deliveryPriceRule.update({ where: { id: d.id }, data })
          : await db.deliveryPriceRule.create({ data });
        revalidatePath("/admin/dostava");
        revalidatePath("/checkout/podaci");
        return {
          ok: true as const,
          entityId: saved.id,
          diff: data,
          message: "Pravilo dostave je sačuvano.",
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
  ]);
  const [smallProvider, deliveryWindows] = await Promise.all([
    getSelectedSmallParcelProvider(),
    getDeliveryWindows(),
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
          <CardTitle description="Ručni izbor važi za nove male kurirske pošiljke, checkout i knjiženje naloga u Modulu 13.">
            Aktivni kurir za male pošiljke
          </CardTitle>
          <AdminActionForm
            action={updateSmallParcelProvider}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Field label="Kurirska služba">
              <select
                key={smallProvider}
                name="provider"
                defaultValue={smallProvider}
                className="h-8 min-w-52 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="MYGLS">MyGLS</option>
                <option value="X_EXPRESS">X Express</option>
              </select>
            </Field>
            <SubmitButton pendingLabel="Čuvanje…">Sačuvaj izbor</SubmitButton>
          </AdminActionForm>
          <p className="mt-3 text-xs text-ink-500">
            Automatska pravila izbora još nisu uključena. Već kreirane aktivne
            pošiljke ostaju kod prvobitnog kurira da ne bi nastao dupli nalog.
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
                  courier: r.courierPrice ? formatRsd(num(r.courierPrice)) : "—",
                  truck: r.truckPrice ? formatRsd(num(r.truckPrice)) : "—",
                  assembly: r.assemblyPrice ? formatRsd(num(r.assemblyPrice)) : "—",
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
            <CardTitle>Novo pravilo</CardTitle>
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
                <Field label="Kurir">
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
                <SubmitButton>Dodaj</SubmitButton>
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
            <ProviderStatus active={smallProvider === "X_EXPRESS"} />
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
            <ProviderStatus active={smallProvider === "MYGLS"} />
            <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="text-sm text-ink-700">
                <p>
                  MyGLS keš sadrži paket shopove/lockere i lokacije za Srbiju.
                  Koristi se kada ga izaberete kao aktivnog kurira iznad.
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
          <CardTitle description="Toggle za kamionsku isporuku po gradu.">
            Gradovi
          </CardTitle>
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
        </Card>
      </div>
    </>
  );
}

function ProviderStatus({ active }: { active: boolean }) {
  return (
    <span
      className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        active ? "bg-green-50 text-green-700" : "bg-ink-50 text-ink-500"
      }`}
    >
      {active ? "Aktivan kurir za male pošiljke" : "Nije aktivan provider"}
    </span>
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
