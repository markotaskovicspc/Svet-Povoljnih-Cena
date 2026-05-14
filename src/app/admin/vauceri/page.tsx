import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { VoucherKind } from "@prisma/client";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Vaučeri",
  robots: { index: false, follow: false },
};

const schema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_-]+$/i, "Samo slova/cifre/-/_"),
  kind: z.nativeEnum(VoucherKind),
  amount: z.coerce.number().nonnegative(),
  minSubtotal: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  usageLimit: z
    .union([z.coerce.number().int().min(1), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  perUserLimit: z
    .union([z.coerce.number().int().min(1), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  active: z.coerce.boolean().default(true),
});

async function upsert(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["OPS"], action: "voucher.upsert", entity: "Voucher" },
    async (_a, formData: FormData) => {
        const parsed = schema.safeParse({
          ...Object.fromEntries(formData),
          active: formData.get("active") === "on" || formData.get("active") === "true",
        });
        if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        const d = parsed.data;
        const code = d.code.toUpperCase();
        const data = {
          kind: d.kind,
          amount: d.amount,
          minSubtotal: d.minSubtotal ?? null,
          startsAt: d.startsAt ? new Date(d.startsAt) : null,
          endsAt: d.endsAt ? new Date(d.endsAt) : null,
          usageLimit: d.usageLimit ?? null,
          perUserLimit: d.perUserLimit ?? null,
          active: d.active,
        };
        const saved = await db.voucher.upsert({
          where: { code },
          create: { code, ...data },
          update: data,
        });
        revalidatePath("/admin/vauceri");
        return { ok: true as const, entityId: saved.code, diff: data };
      },
  )(formData);
}

async function remove(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["OPS"], action: "voucher.delete", entity: "Voucher" },
    async (_a, formData: FormData) => {
        const code = String(formData.get("code") ?? "");
        if (!code) return { ok: false as const, error: "Nedostaje kod." };
        await db.voucher.delete({ where: { code } });
        revalidatePath("/admin/vauceri");
        return { ok: true as const, entityId: code };
      },
  )(formData);
}

const dt = (d?: Date | null) => {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default async function VouchersPage() {
  await requireAdminAction(["OPS"]);
  const vouchers = await db.voucher.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { redemptions: true } } },
  });

  return (
    <>
      <PageHeader
        title="Vaučeri"
        description="Promo kodovi — procenat ili fiksni iznos, sa minimumom narudžbine i limitima upotrebe."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Vaučeri" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_400px]">
        <Card className="p-0">
          <DataTable
            columns={[
              { key: "code", label: "Kod" },
              { key: "kind", label: "Tip" },
              { key: "amount", label: "Vrednost", align: "right" },
              { key: "min", label: "Min. narudžbina", align: "right" },
              { key: "used", label: "Korišćen", align: "right" },
              { key: "active", label: "Aktivan", align: "center" },
              { key: "actions", label: "" },
            ]}
            rows={vouchers.map((v) => ({
              id: v.code,
              cells: {
                code: <span className="font-mono">{v.code}</span>,
                kind: v.kind,
                amount:
                  v.kind === "PERCENT"
                    ? `${num(v.amount)}%`
                    : formatRsd(num(v.amount)),
                min: v.minSubtotal ? formatRsd(num(v.minSubtotal)) : "—",
                used: `${v._count.redemptions}${v.usageLimit ? ` / ${v.usageLimit}` : ""}`,
                active: v.active ? "✓" : "—",
                actions: (
                  <div className="flex justify-end gap-2">
                    <a href={`#edit-${v.code}`} className="text-xs text-walnut hover:underline">
                      Izmeni
                    </a>
                    <form action={remove}>
                      <input type="hidden" name="code" value={v.code} />
                      <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                        ×
                      </SubmitButton>
                    </form>
                  </div>
                ),
              },
            }))}
            empty="Nema vaučera."
          />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardTitle>Novi vaučer</CardTitle>
            <VoucherForm action={upsert} />
          </Card>
          {vouchers.map((v) => (
            <Card key={v.code} id={`edit-${v.code}`} className="scroll-mt-24">
              <CardTitle>Izmena: {v.code}</CardTitle>
              <VoucherForm
                action={upsert}
                values={{
                  code: v.code,
                  kind: v.kind,
                  amount: num(v.amount),
                  minSubtotal: v.minSubtotal ? num(v.minSubtotal) : "",
                  startsAt: dt(v.startsAt),
                  endsAt: dt(v.endsAt),
                  usageLimit: v.usageLimit ?? "",
                  perUserLimit: v.perUserLimit ?? "",
                  active: v.active,
                }}
                lockCode
              />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

type V = {
  code?: string;
  kind?: VoucherKind;
  amount?: number;
  minSubtotal?: number | string;
  startsAt?: string;
  endsAt?: string;
  usageLimit?: number | string;
  perUserLimit?: number | string;
  active?: boolean;
};

function VoucherForm({
  action,
  values,
  lockCode,
}: {
  action: (fd: FormData) => Promise<void>;
  values?: V;
  lockCode?: boolean;
}) {
  return (
    <form action={action} className="space-y-3">
      <Field label="Kod">
        <Input
          name="code"
          required
          readOnly={lockCode}
          defaultValue={values?.code ?? ""}
          placeholder="DOBRODOSLI10"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tip">
          <select
            name="kind"
            defaultValue={values?.kind ?? "PERCENT"}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="PERCENT">PERCENT</option>
            <option value="FIXED">FIXED</option>
          </select>
        </Field>
        <Field label="Vrednost">
          <Input name="amount" type="number" min={0} required defaultValue={values?.amount ?? 0} />
        </Field>
      </div>
      <Field label="Min. iznos korpe (opciono)">
        <Input name="minSubtotal" type="number" min={0} defaultValue={values?.minSubtotal ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Počinje">
          <Input name="startsAt" type="datetime-local" defaultValue={values?.startsAt ?? ""} />
        </Field>
        <Field label="Završava">
          <Input name="endsAt" type="datetime-local" defaultValue={values?.endsAt ?? ""} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ukupan limit">
          <Input name="usageLimit" type="number" min={1} defaultValue={values?.usageLimit ?? ""} />
        </Field>
        <Field label="Po korisniku">
          <Input name="perUserLimit" type="number" min={1} defaultValue={values?.perUserLimit ?? ""} />
        </Field>
      </div>
      <Field label="Aktivan">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={values?.active ?? true} className="size-4 accent-walnut" />
          Dozvoli upotrebu
        </label>
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{lockCode ? "Sačuvaj" : "Dodaj"}</SubmitButton>
      </div>
    </form>
  );
}
