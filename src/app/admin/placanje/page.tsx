import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { PaymentMethod } from "@prisma/client";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Načini plaćanja",
  robots: { index: false, follow: false },
};

const LABEL: Record<PaymentMethod, string> = {
  IPS: "IPS QR (NBS)",
  KARTICA: "Kartica (WSPay)",
  GOOGLE_PAY: "Google Pay",
  APPLE_PAY: "Apple Pay",
  UPLATA_NA_RACUN: "Uplata na račun",
  POUZECE_GOTOVINA: "Pouzeće — gotovina",
  POUZECE_KARTICA: "Pouzeće — kartica",
};

async function updateMethod(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["OPS"], action: "payment.update", entity: "PaymentMethodConfig" },
    async (_a, formData: FormData) => {
        const method = String(formData.get("method") ?? "") as PaymentMethod;
        if (!Object.values(PaymentMethod).includes(method)) {
          return { ok: false as const, error: "Nepoznat metod." };
        }
        const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
        const label = String(formData.get("label") ?? "").trim() || null;
        const note = String(formData.get("note") ?? "").trim() || null;
        await db.paymentMethodConfig.upsert({
          where: { method },
          create: { method, enabled, label, note },
          update: { enabled, label, note },
        });
        revalidatePath("/admin/placanje");
        revalidatePath("/checkout");
        return { ok: true as const, entityId: method, diff: { enabled, label, note } };
      },
  )(formData);
}

export default async function PaymentsPage() {
  await requireAdminAction(["OPS"]);
  const configs = await db.paymentMethodConfig.findMany();
  const map = new Map(configs.map((c) => [c.method, c]));

  return (
    <>
      <PageHeader
        title="Načini plaćanja"
        description="Kontrolišite koji su načini plaćanja vidljivi na checkout-u."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Plaćanje" }]}
      />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        {Object.values(PaymentMethod).map((method) => {
          const cfg = map.get(method);
          return (
            <Card key={method}>
              <CardTitle description={method}>{LABEL[method]}</CardTitle>
              <form action={updateMethod} className="space-y-3">
                <input type="hidden" name="method" value={method} />
                <Field label="Aktivan">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={cfg?.enabled ?? true}
                      className="size-4 accent-walnut"
                    />
                    Prikaži u checkout-u
                  </label>
                </Field>
                <Field label="Custom labela (opciono)">
                  <Input name="label" defaultValue={cfg?.label ?? ""} placeholder={LABEL[method]} />
                </Field>
                <Field label="Napomena za kupca">
                  <Input name="note" defaultValue={cfg?.note ?? ""} />
                </Field>
                <div className="flex justify-end">
                  <SubmitButton>Sačuvaj</SubmitButton>
                </div>
              </form>
            </Card>
          );
        })}
      </div>
    </>
  );
}
