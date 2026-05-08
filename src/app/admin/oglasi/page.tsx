import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { AdChannel } from "@prisma/client";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Oglasi & feedovi",
  robots: { index: false, follow: false },
};

const CHANNEL_LABEL: Record<AdChannel, string> = {
  GOOGLE_MERCHANT: "Google Merchant",
  META: "Meta katalog",
  TIKTOK: "TikTok katalog",
};

const saveFlag = withAdmin(
  { allowed: ["ADS"], action: "ad.flagSave", entity: "AdFlag" },
  async (_a, formData: FormData) => {
    const channel = String(formData.get("channel") ?? "") as AdChannel;
    if (!Object.values(AdChannel).includes(channel)) {
      return { ok: false as const, error: "Nepoznat kanal." };
    }
    const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
    const budgetRaw = String(formData.get("budgetRsd") ?? "").trim();
    const budget = budgetRaw === "" ? null : Number(budgetRaw);
    if (budget !== null && !Number.isFinite(budget)) {
      return { ok: false as const, error: "Budžet mora biti broj." };
    }
    await db.adFlag.upsert({
      where: { channel },
      create: { channel, enabled, budgetRsd: budget },
      update: { enabled, budgetRsd: budget },
    });
    revalidatePath("/admin/oglasi");
    return { ok: true as const, entityId: channel, diff: { enabled, budget } };
  },
);

const FIELD_BY_CHANNEL: Record<AdChannel, "inGoogleMerchant" | "inMetaCatalog" | "inTiktokCatalog"> = {
  GOOGLE_MERCHANT: "inGoogleMerchant",
  META: "inMetaCatalog",
  TIKTOK: "inTiktokCatalog",
};

const toggleProductCatalog = withAdmin(
  { allowed: ["ADS"], action: "ad.productToggle", entity: "Product" },
  async (_a, formData: FormData) => {
    const productId = String(formData.get("productId") ?? "");
    const channel = String(formData.get("channel") ?? "") as AdChannel;
    const next = formData.get("next") === "true";
    if (!productId || !FIELD_BY_CHANNEL[channel]) {
      return { ok: false as const, error: "Pogrešni parametri." };
    }
    await db.product.update({
      where: { id: productId },
      data: { [FIELD_BY_CHANNEL[channel]]: next },
    });
    revalidatePath("/admin/oglasi");
    return { ok: true as const, entityId: productId, diff: { [channel]: next } };
  },
);

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdminAction(["ADS"]);
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";

  const [flags, products] = await Promise.all([
    db.adFlag.findMany(),
    db.product.findMany({
      where: q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : { isActive: true },
      orderBy: { name: "asc" },
      take: 100,
      select: {
        id: true,
        sku: true,
        name: true,
        inGoogleMerchant: true,
        inMetaCatalog: true,
        inTiktokCatalog: true,
      },
    }),
  ]);
  const flagMap = new Map(flags.map((f) => [f.channel, f]));

  return (
    <>
      <PageHeader
        title="Oglasi & feedovi"
        description="Kanali sinhronizacije kataloga i ad budgets."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Oglasi" }]}
      />
      <div className="space-y-6 px-8 py-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Object.values(AdChannel).map((channel) => {
            const f = flagMap.get(channel);
            return (
              <Card key={channel}>
                <CardTitle description={channel}>{CHANNEL_LABEL[channel]}</CardTitle>
                <form action={saveFlag} className="space-y-3">
                  <input type="hidden" name="channel" value={channel} />
                  <Field label="Aktivno">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={f?.enabled ?? false}
                        className="size-4 accent-walnut"
                      />
                      Sinhronizuj feed
                    </label>
                  </Field>
                  <Field label="Mesečni budžet (RSD)">
                    <Input
                      type="number"
                      step="100"
                      min={0}
                      name="budgetRsd"
                      defaultValue={f?.budgetRsd?.toString() ?? ""}
                    />
                  </Field>
                  <div className="flex justify-end">
                    <SubmitButton size="sm">Sačuvaj</SubmitButton>
                  </div>
                </form>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardTitle description={`${products.length} proizvoda`}>Katalog po proizvodu</CardTitle>
          <form className="mb-4 flex items-end gap-3" method="get">
            <div className="flex-1">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Pretraga (SKU ili naziv)
              </label>
              <Input name="q" defaultValue={q} />
            </div>
            <button
              type="submit"
              className="h-8 rounded-lg bg-walnut px-4 text-sm font-medium text-white hover:bg-walnut/90"
            >
              Filtriraj
            </button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-ink-500">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Naziv</th>
                  {Object.values(AdChannel).map((c) => (
                    <th key={c} className="px-3 py-2 text-center">{CHANNEL_LABEL[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                    <td className="px-3 py-2">{p.name}</td>
                    {Object.values(AdChannel).map((c) => {
                      const field = FIELD_BY_CHANNEL[c];
                      const cur = p[field];
                      return (
                        <td key={c} className="px-3 py-2 text-center">
                          <form action={toggleProductCatalog}>
                            <input type="hidden" name="productId" value={p.id} />
                            <input type="hidden" name="channel" value={c} />
                            <input type="hidden" name="next" value={String(!cur)} />
                            <SubmitButton size="sm" variant={cur ? "default" : "outline"}>
                              {cur ? "✓" : "—"}
                            </SubmitButton>
                          </form>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-ink-500">
                      Nema proizvoda za prikaz.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
