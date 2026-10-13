import { AdminError, AdminLoginForm } from "@/app/admin/prijava/form";
import { loginAction } from "@/app/admin/prijava/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prijava u magacin", robots: { index: false, follow: false } };
export default async function WarehouseLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
    <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-surface p-6 shadow-sm">
      <p className="text-sm text-ink-500">Svet Povoljnih Cena</p>
      <h1 className="mt-2 text-2xl font-semibold">Prijava u magacin</h1>
      <p className="mt-2 text-sm text-ink-500">Unesite e-poštu i lozinku koje ste dobili od odgovorne osobe.</p>
      <AdminError hasError={!!error} />
      <form action={loginAction} className="mt-6 space-y-4 [&_input]:min-h-12 [&_input]:text-base [&_button]:min-h-12">
        <input type="hidden" name="callbackUrl" value="/admin/magacin" />
        <AdminLoginForm />
      </form>
    </div>
  </main>;
}
