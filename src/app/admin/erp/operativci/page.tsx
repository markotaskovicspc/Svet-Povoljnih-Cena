import Link from "next/link";
import { WarehouseLoginLink } from "@/components/admin/warehouse-login-link";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { AdminActionForm } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { createOperator, setOperatorEnabled } from "./actions";
export const dynamic = "force-dynamic";
export default async function OperatorsPage() {
  await requireAdminAction(["OPS"]);
  const accounts = await db.adminUser.findMany({ where: { role: "WAREHOUSE" }, orderBy: [{ enabled: "desc" }, { createdAt: "desc" }], select: { id: true, email: true, firstName: true, lastName: true, enabled: true, lastLoginAt: true } });
  return <><PageHeader title="Nalozi magacionera" description="Pristup samo pickingu i povratima. Svaki magacioner koristi svoj nalog." />
    <main className="space-y-6 p-4 md:p-8">
      <section className="rounded-xl border bg-surface p-5"><h2 className="text-lg font-semibold">Link za prijavu</h2><p className="mt-2 text-sm text-ink-500">Prosledite ovaj link zaposlenima zajedno sa njihovom e-poštom i lozinkom.</p><Link href="/admin/magacin/prijava" className="mt-3 inline-block break-all rounded-lg border px-4 py-3 font-mono text-sm">/admin/magacin/prijava</Link><Link href="/admin/magacin" className="ml-4 inline-block py-3 text-sm underline">Otvori prostor za magacin →</Link><WarehouseLoginLink /></section>
      <section className="rounded-xl border bg-surface p-5"><h2 className="text-lg font-semibold">Novi nalog</h2>
        <AdminActionForm action={createOperator} refreshOnSuccess className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ime"><input name="firstName" required maxLength={80} autoComplete="off" className="w-full rounded-lg border px-3 py-2" /></Field>
          <Field label="Prezime"><input name="lastName" maxLength={80} autoComplete="off" className="w-full rounded-lg border px-3 py-2" /></Field>
          <Field label="E-pošta za prijavu"><input name="email" type="email" required maxLength={254} autoComplete="off" className="w-full rounded-lg border px-3 py-2" /></Field>
          <Field label="Lozinka (najmanje 8 znakova)"><input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className="w-full rounded-lg border px-3 py-2" /></Field>
          </div>
          <div><SubmitButton pendingLabel="Pravljenje naloga…">Napravi nalog magacionera</SubmitButton></div>
        </AdminActionForm>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Magacioneri ({accounts.length})</h2>{accounts.map(account => <article key={account.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-surface p-4">
        <div className="min-w-0"><h3 className="font-medium">{[account.firstName, account.lastName].filter(Boolean).join(" ")}</h3><p className="break-all text-sm text-ink-500">{account.email}</p><p className="mt-1 text-sm">{account.enabled ? "Pristup uključen" : "Pristup isključen"} · {account.lastLoginAt ? `Poslednja prijava: ${account.lastLoginAt.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}` : "Još se nije prijavio"}</p></div>
        <AdminActionForm action={setOperatorEnabled} refreshOnSuccess><input type="hidden" name="id" value={account.id} /><input type="hidden" name="enabled" value={String(!account.enabled)} /><SubmitButton variant="outline" confirm={account.enabled ? "Isključiti pristup ovom magacioneru?" : undefined}>{account.enabled ? "Isključi pristup" : "Uključi pristup"}</SubmitButton></AdminActionForm>
      </article>)}{!accounts.length && <p className="text-sm text-ink-500">Još nema naloga magacionera.</p>}</section>
    </main></>;
}
