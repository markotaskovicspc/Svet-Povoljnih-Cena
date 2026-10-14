"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { adminLoginDestination } from "@/lib/admin/login-destination";
import { signIn } from "@/lib/auth/auth";
import { AuthError } from "next-auth";
import { checkRateLimit, getClientIpFromHeaders, rateLimitKey, RATE_LIMITS } from "@/lib/security/rate-limit";
export async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const callbackUrl = String(formData.get("callbackUrl") ?? "/admin/erp") || "/admin/erp";
  const warehouseLogin = callbackUrl === "/admin/magacin";
  const loginPath = warehouseLogin ? "/admin/magacin/prijava" : "/admin/prijava";
  const headersList = await headers();
  const limited = await checkRateLimit(
    rateLimitKey(
      "admin-login:action",
      getClientIpFromHeaders(headersList),
      email.toLowerCase(),
    ),
    RATE_LIMITS.adminLogin,
  );
  if (!limited.ok) {
    redirect(
      `${loginPath}?error=1&callbackUrl=${encodeURIComponent(callbackUrl)}`,
    );
  }
  try {
    const account = await db.adminUser.findUnique({ where: { email: email.toLowerCase() }, select: { role: true } });
    await signIn("admin-credentials", {
      email,
      password,
      redirect: true,
      redirectTo: adminLoginDestination(account?.role, callbackUrl),
    });
  } catch (err) {
    // next-auth throws a redirect — let Next handle it. Only catch credential errors.
    if (err instanceof AuthError) {
      redirect(
        `${loginPath}?error=1&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    throw err;
  }
}

