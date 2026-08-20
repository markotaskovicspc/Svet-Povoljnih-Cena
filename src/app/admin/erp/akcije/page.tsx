import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminAction, withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { PageHeader } from "@/components/admin/page-header";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionsAdmin } from "./actions-admin";
import { getErpModule } from "@/lib/admin/erp";
import { ErpGrid } from "@/components/admin/erp-grid";
import { formatBelgradePricingDateTime } from "@/lib/admin/pricing-date-time";
import { storefrontMonth } from "@/lib/storefront/promotion-filters";
import { actionGrossMarginPct } from "@/lib/pricing/action-bm";
import {
  getMonthlyActionMetadata,
  MONTHLY_ACTION_METADATA_SETTING_KEY,
} from "@/lib/storefront/monthly-action-metadata";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Akcije",
  robots: { index: false, follow: false },
};

const monthlyActionMetadataSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(320),
});

async function updateMonthlyActionMetadata(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["CONTENT"],
      action: "storefront.monthlyActionMetadata.update",
      entity: "AdminSetting",
    },
    async (actorId, actionData: FormData) => {
      const parsed = monthlyActionMetadataSchema.safeParse({
        title: actionData.get("title"),
        description: actionData.get("description"),
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error:
            parsed.error.issues[0]?.message ??
            "Naslov i SEO opis nisu ispravni.",
        };
      }
      await db.adminSetting.upsert({
        where: { key: MONTHLY_ACTION_METADATA_SETTING_KEY },
        create: {
          key: MONTHLY_ACTION_METADATA_SETTING_KEY,
          value: parsed.data,
          updatedBy: actorId,
        },
        update: { value: parsed.data, updatedBy: actorId },
      });
      revalidatePath("/admin/erp/akcije");
      revalidatePath("/akcija");
      return {
        ok: true as const,
        entityId: MONTHLY_ACTION_METADATA_SETTING_KEY,
        diff: parsed.data,
        message: "Naslov i SEO opis Mesečne akcije su sačuvani.",
      };
    },
  )(formData);
}

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  await requireAdminAction(["CONTENT"]);
  const params = await searchParams;
  const [
    actions,
    loyaltyRules,
    linearPromotions,
    categories,
    groups,
    erpModule,
    databaseClock,
    monthlyActionMetadata,
  ] =
    await Promise.all([
      db.action.findMany({
        orderBy: [{ priority: "desc" }, { startsAt: "desc" }],
        include: {
          heroes: {
            select: { productSku: true, month: true, year: true },
          },
          actionPrices: {
            orderBy: { product: { sku: "asc" } },
            include: {
              product: {
                include: {
                  supplier: { select: { name: true } },
                  group: { select: { name: true } },
                  collection: { select: { name: true } },
                  categories: {
                    include: {
                      category: { select: { name: true, level: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      db.loyaltyRule.findMany({
        orderBy: [{ startsAt: "desc" }, { priority: "desc" }],
      }),
      db.linearPromotion.findMany({
        orderBy: [{ startsAt: "desc" }, { priority: "desc" }],
        include: {
          categories: {
            include: { category: { select: { id: true, name: true } } },
          },
          groups: {
            include: { group: { select: { id: true, name: true } } },
          },
        },
      }),
      db.category.findMany({
        orderBy: [{ level: "asc" }, { name: "asc" }],
        select: { id: true, name: true, path: true, level: true },
      }),
      db.group.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      getErpModule("akcije", { take: 10_000 }),
      db.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS "now"`,
      getMonthlyActionMetadata(),
    ]);

  const productIds = Array.from(
    new Set(
      actions.flatMap((action) =>
        action.actionPrices.map((entry) => entry.productId),
      ),
    ),
  );
  const retailEntries = productIds.length
    ? await db.priceListEntry.findMany({
        where: {
          productId: { in: productIds },
          priceList: {
            is: {
              kind: "RETAIL",
              active: true,
              OR: [
                { name: { contains: "MP", mode: "insensitive" } },
                { code: { contains: "MP", mode: "insensitive" } },
              ],
            },
          },
        },
        orderBy: { validFrom: "desc" },
        include: {
          priceList: {
            select: { validFrom: true, validTo: true },
          },
        },
      })
    : [];

  const retailPriceAt = (productId: string, at: Date, fallback: number) => {
    const time = at.getTime();
    const entry = retailEntries.find(
      (candidate) =>
        candidate.productId === productId &&
        candidate.validFrom.getTime() <= time &&
        (!candidate.validTo || candidate.validTo.getTime() >= time) &&
        (!candidate.priceList.validFrom ||
          candidate.priceList.validFrom.getTime() <= time) &&
        (!candidate.priceList.validTo ||
          candidate.priceList.validTo.getTime() >= time),
    );
    return entry ? Number(entry.price) : fallback;
  };

  const actionRows = actions.map((action) => ({
    id: action.id,
    name: action.name,
    slug: action.slug,
    kind: action.kind,
    startsAt: formatBelgradePricingDateTime(action.startsAt),
    endsAt: formatBelgradePricingDateTime(action.endsAt),
    isHero: action.isHero,
    isPermanent: action.isPermanent,
    sortOrder: action.sortOrder,
    priority: action.priority,
    products: action.actionPrices.map((entry) => {
      const product = entry.product;
      const heroPeriod = storefrontMonth(action.startsAt);
      const productCategories = [...product.categories].sort(
        (left, right) =>
          left.category.level - right.category.level,
      );
      return {
        productId: product.id,
        sku: product.sku,
        supplier: product.supplier?.name ?? "—",
        category: productCategories[0]?.category.name ?? "—",
        group: product.group?.name ?? "—",
        subgroup:
          productCategories.length > 1
            ? productCategories[productCategories.length - 1]?.category.name ??
              "—"
            : "—",
        collection: product.collection?.name ?? "—",
        shortDescription: product.shortDescription ?? "—",
        shortName: product.name,
        attribute1: product.attribute1 ?? "—",
        attribute2: product.attribute2 ?? "—",
        attribute3: product.attribute3 ?? "—",
        attribute4: product.attribute4 ?? "—",
        color1: product.colorPrimary ?? "—",
        color2: product.colorSecondary ?? "—",
        isHero: action.heroes.some(
          (hero) =>
            hero.productSku === product.sku &&
            hero.month === heroPeriod.month &&
            hero.year === heroPeriod.year,
        ),
        validMpPrice: retailPriceAt(
          product.id,
          action.startsAt,
          Number(product.fullPrice),
        ),
        salePrice: Number(entry.salePrice),
        bmPct: actionGrossMarginPct(
          Number(entry.salePrice),
          product.cogs == null ? null : Number(product.cogs),
        ),
      };
    }),
  }));

  return (
    <>
      <PageHeader
        title="Akcije"
        description="MP i akcijske MP cene, heroji meseca, loyalty i linearni popusti."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Akcije" },
        ]}
      />
      <div className="px-4 pt-6 md:px-8">
        <Card>
          <CardTitle description="Ovde se menja tekst koji se vidi u browser tabu uz stranicu Mesečna akcija.">
            Naslov stranice Mesečna akcija
          </CardTitle>
          <AdminActionForm
            action={updateMonthlyActionMetadata}
            className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end"
          >
            <Field label="Naslov browser taba">
              <Input
                name="title"
                maxLength={160}
                required
                defaultValue={monthlyActionMetadata.title}
              />
            </Field>
            <Field label="SEO opis">
              <Textarea
                name="description"
                maxLength={320}
                rows={2}
                required
                defaultValue={monthlyActionMetadata.description}
              />
            </Field>
            <SubmitButton pendingLabel="Čuvanje…">Sačuvaj naslov</SubmitButton>
          </AdminActionForm>
        </Card>
      </div>
      {erpModule ? (
        <div className="px-4 pt-6 md:px-8">
          <ErpGrid module={erpModule} />
        </div>
      ) : null}
      <ActionsAdmin
        actions={actionRows}
        referenceTime={databaseClock[0]!.now.getTime()}
        initialSelectedId={params.edit}
        loyaltyRules={loyaltyRules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          discountPct: Number(rule.discountPct),
          priority: rule.priority,
          startsAt: formatBelgradePricingDateTime(rule.startsAt),
          endsAt: formatBelgradePricingDateTime(rule.endsAt),
          active: rule.active,
        }))}
        linearPromotions={linearPromotions.map((promotion) => ({
          id: promotion.id,
          name: promotion.name,
          discountPct: Number(promotion.discountPct),
          priority: promotion.priority,
          startsAt: formatBelgradePricingDateTime(promotion.startsAt),
          endsAt: formatBelgradePricingDateTime(promotion.endsAt),
          active: promotion.active,
          categoryIds: promotion.categories.map((item) => item.category.id),
          groupIds: promotion.groups.map((item) => item.group.id),
          categories: promotion.categories.map(
            (item) => item.category.name,
          ),
          groups: promotion.groups.map((item) => item.group.name),
        }))}
        categories={categories}
        groups={groups}
      />
    </>
  );
}
