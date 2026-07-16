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
    .union([z.literal("").transform(() => null), z.coerce.number().nonnegative()])
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

export default async function VouchersPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const params = await searchParams;
  const vouchers = await db.voucher.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { redemptions: true } } },
  });
  const selected = params.new === "1"
    ? undefined
    : vouchers.find((voucher) => voucher.code === params.edit) ?? vouchers[0];

  return (
    <>
      <PageHeader
        title="Vaučeri"
        description="Promo kodovi — procenat ili fiksni iznos, sa minimumom narudžbine i limitima upotrebe."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Vaučeri" }]}
      />
      <div className="grid grid-cols-1 items-start gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="max-h-[calc(100vh-11rem)] overflow-y-auto p-0">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white px-4 py-3">
            <div>
              <p className="font-display text-lg font-semibold text-ink-900">Lista vaučera</p>
              <p className="text-xs text-ink-500">Izaberite vaučer za izmenu.</p>
            </div>
            <a href="/admin/vauceri?new=1" className="rounded-lg bg-walnut px-3 py-1.5 text-xs font-semibold text-white hover:bg-walnut/90">
              Novi vaučer
            </a>
          </div>
          <DataTable
            columns={[
              { key: "code", label: "Vaučer" },
              { key: "amount", label: "Vrednost", align: "right" },
              { key: "used", label: "Korišćen", align: "right" },
              { key: "actions", label: "" },
            ]}
            rows={vouchers.map((v) => ({
              id: v.code,
              cells: {
                code: (
                  <div>
                    <p className="font-mono font-medium">{v.code}</p>
                    <p className="text-[11px] text-ink-500">{v.kind} · {v.active ? "Aktivan" : "Neaktivan"}</p>
                  </div>
                ),
                amount: (
                  <div>
                    <p>{v.kind === "PERCENT" ? `${num(v.amount)}%` : formatRsd(num(v.amount))}</p>
                    <p className="text-[11px] text-ink-500">min. {v.minSubtotal ? formatRsd(num(v.minSubtotal)) : "bez minimuma"}</p>
                  </div>
                ),
                used: `${v._count.redemptions}${v.usageLimit ? ` / ${v.usageLimit}` : ""}`,
                actions: (
                  <div className="flex justify-end gap-2">
                    <a href={`/admin/vauceri?edit=${encodeURIComponent(v.code)}`} className="text-xs text-walnut hover:underline">
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
        <Card className="xl:sticky xl:top-6">
          <CardTitle>{selected ? `Izmena: ${selected.code}` : "Novi vaučer"}</CardTitle>
          <VoucherForm
            key={selected?.code ?? "new"}
            action={upsert}
            values={selected ? {
              code: selected.code,
              kind: selected.kind,
              amount: num(selected.amount),
              minSubtotal: selected.minSubtotal ? num(selected.minSubtotal) : "",
              startsAt: dt(selected.startsAt),
              endsAt: dt(selected.endsAt),
              usageLimit: selected.usageLimit ?? "",
              perUserLimit: selected.perUserLimit ?? "",
              active: selected.active,
            } : undefined}
            lockCode={Boolean(selected)}
          />
        </Card>
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
