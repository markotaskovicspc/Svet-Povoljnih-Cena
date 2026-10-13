import { Suspense } from "react";
import { AdminError, AdminLoginForm } from "./form";
import { BRAND } from "@/lib/brand";
import { loginAction } from "./actions";

export const metadata = {
  title: "Admin prijava",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = sp.callbackUrl ?? "/admin/erp";

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-surface p-8 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-500">
          {BRAND.name}
        </p>
        <h1 className="mt-1 font-display text-2xl tracking-tight">
          Admin prijava
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Prijavite se sa nalogom administratora.
        </p>
        <Suspense>
          <AdminError hasError={!!sp.error} />
        </Suspense>
        <form action={loginAction} className="mt-6 space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <AdminLoginForm />
        </form>
      </div>
    </div>
  );
}
