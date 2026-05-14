import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AdminError, AdminLoginForm } from "./form";
import { signIn } from "@/lib/auth/auth";
import { AuthError } from "next-auth";

export const metadata = {
  title: "Admin prijava",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const callbackUrl = String(formData.get("callbackUrl") ?? "/admin/erp") || "/admin/erp";
  try {
    await signIn("admin-credentials", {
      email,
      password,
      redirect: true,
      redirectTo: callbackUrl.startsWith("/admin") ? callbackUrl : "/admin",
    });
  } catch (err) {
    // next-auth throws a redirect — let Next handle it. Only catch credential errors.
    if (err instanceof AuthError) {
      redirect(
        `/admin/prijava?error=1&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    throw err;
  }
}

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
          Svet Akcija
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
