import Link from "next/link";
import { WarehouseLoginLink } from "@/components/admin/warehouse-login-link";
import { ADMIN_ROLE_LABEL, requireAdminAction } from "@/lib/admin";
import { effectiveAdminModules, permissionGroups } from "@/lib/admin/access-policy";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { AdminActionForm } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { StaffPermissionSelector } from "@/components/admin/staff-permission-selector";
import { createOperator, setOperatorEnabled, createStaffAccount, updateStaffAccountAccess, setStaffAccountEnabled } from "./actions";
export const dynamic = "force-dynamic";

const moduleLabels = new Map(permissionGroups.flatMap(group => group.modules.map(module => [module.key, module.label] as const)));

function AccountFields() {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="Ime"><input name="firstName" required maxLength={80} autoComplete="off" className="w-full rounded-lg border px-3 py-2" /></Field>
    <Field label="Prezime"><input name="lastName" maxLength={80} autoComplete="off" className="w-full rounded-lg border px-3 py-2" /></Field>
    <Field label="E-pošta za prijavu"><input name="email" type="email" required maxLength={254} autoComplete="off" className="w-full rounded-lg border px-3 py-2" /></Field>
    <Field label="Lozinka (najmanje 8 znakova)"><input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className="w-full rounded-lg border px-3 py-2" /></Field>
  </div>;
}

export default async function OperatorsPage() {
  const admin = await requireAdminAction(["OPS"], "/admin/erp/operativci");
  const isSuper = admin.role === "SUPER";
  const accounts = await db.adminUser.findMany({
    where: isSuper ? { role: { not: "SUPER" } } : { role: "WAREHOUSE" },
    orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
    select: { id: true, email: true, firstName: true, lastName: true, role: true,
      accessPolicy: true, enabled: true, lastLoginAt: true },
  });
  return <><PageHeader title={isSuper ? "Korisnički nalozi" : "Nalozi magacionera"}
    description={isSuper ? "Svakom zaposlenom odredite pristup celinama i pojedinačnim modulima." : "Pristup samo pickingu i povratima. Svaki magacioner koristi svoj nalog."} />
    <main className="space-y-6 p-4 md:p-8">
      <section className="rounded-xl border bg-surface p-5"><h2 className="text-lg font-semibold">Link za prijavu</h2>
        <p className="mt-2 text-sm text-ink-500">Prosledite zaposlenom odgovarajući link zajedno sa njegovom e-poštom i lozinkom.</p>
        {isSuper && <div className="mt-3"><Link href="/admin/prijava" className="inline-block break-all rounded-lg border px-4 py-3 font-mono text-sm">/admin/prijava</Link><p className="mt-1 text-xs text-ink-500">Za korisnike sa odabranim modulima.</p></div>}
        <Link href="/admin/magacin/prijava" className="mt-3 inline-block break-all rounded-lg border px-4 py-3 font-mono text-sm">/admin/magacin/prijava</Link><Link href="/admin/magacin" className="ml-4 inline-block py-3 text-sm underline">Otvori prostor za magacin →</Link>
        {isSuper && <p className="mt-1 text-xs text-ink-500">Za korisnike kojima je odobren samo magacin.</p>}<WarehouseLoginLink />
      </section>
      <section className="rounded-xl border bg-surface p-5"><h2 className="text-lg font-semibold">Novi nalog</h2>
        <AdminActionForm action={isSuper ? createStaffAccount : createOperator} refreshOnSuccess className="mt-4 space-y-4">
          <AccountFields />
          {isSuper && <StaffPermissionSelector />}
          <div><SubmitButton pendingLabel="Pravljenje naloga…">{isSuper ? "Napravi korisnički nalog" : "Napravi nalog magacionera"}</SubmitButton></div>
        </AdminActionForm>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">{isSuper ? "Zaposleni" : "Magacioneri"} ({accounts.length})</h2>
        {accounts.map(account => {
          const modules = effectiveAdminModules(account);
          return <article key={account.id} className="space-y-4 rounded-xl border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0"><h3 className="font-medium">{[account.firstName, account.lastName].filter(Boolean).join(" ") || account.email}</h3>
                <p className="break-all text-sm text-ink-500">{account.email}</p>
                <p className="mt-1 text-sm">{ADMIN_ROLE_LABEL[account.role]} · {account.enabled ? "Pristup uključen" : "Pristup isključen"} · {account.lastLoginAt ? `Poslednja prijava: ${account.lastLoginAt.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}` : "Još se nije prijavio"}</p>
              </div>
              <AdminActionForm action={isSuper ? setStaffAccountEnabled : setOperatorEnabled} refreshOnSuccess>
                <input type="hidden" name="id" value={account.id} /><input type="hidden" name="enabled" value={String(!account.enabled)} />
                <SubmitButton variant="outline" confirm={account.enabled ? "Isključiti pristup ovom zaposlenom?" : undefined}>{account.enabled ? "Isključi pristup" : "Uključi pristup"}</SubmitButton>
              </AdminActionForm>
            </div>
            {isSuper && <p className="text-sm text-ink-500">Dozvoljeni moduli: {modules.map(key => moduleLabels.get(key) ?? key).join(", ") || "Nema odobrenih modula"}</p>}
            {isSuper && <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">Uredi pristup modulima ({modules.length})</summary>
              <AdminActionForm action={updateStaffAccountAccess} refreshOnSuccess className="mt-4 space-y-4">
                <input type="hidden" name="id" value={account.id} />
                <StaffPermissionSelector key={JSON.stringify(modules)} initialModules={modules} />
                <SubmitButton pendingLabel="Čuvanje pristupa…">Sačuvaj pristup modulima</SubmitButton>
              </AdminActionForm>
            </details>}
          </article>;
        })}
        {!accounts.length && <p className="text-sm text-ink-500">{isSuper ? "Još nema naloga zaposlenih." : "Još nema naloga magacionera."}</p>}
      </section>
    </main></>;
}
