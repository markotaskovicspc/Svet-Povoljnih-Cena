"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth/auth";
import { customerCallback } from "@/lib/auth/customer-callback";
import { isValidCustomerPassword } from "@/lib/auth/customer-password-policy";
import { registerCustomer } from "@/lib/auth/credentials";
import { setMarketingConsent } from "@/lib/auth/gdpr";
import { sendEmailConfirmationForUser } from "@/lib/auth/email-verification";
import {
  checkRateLimit,
  getClientIpFromHeaders,
  rateLimitKey,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import type { LoginErrorCode } from "./prijava/form";
import type { RegistrationErrorCode } from "./registracija/form";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CustomerAuthSurface = "account" | "checkout";

function authSurface(formData: FormData): CustomerAuthSurface {
  return formData.get("authSurface") === "checkout" ? "checkout" : "account";
}

function loginErrorUrl(
  error: LoginErrorCode,
  callbackUrl: string,
  surface: CustomerAuthSurface,
) {
  if (surface === "checkout") {
    return `/checkout/podaci?auth=login&authError=${error}`;
  }
  return `/nalog/prijava?error=${error}&callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

function registrationErrorUrl(
  error: RegistrationErrorCode,
  callbackUrl: string,
  surface: CustomerAuthSurface,
) {
  if (surface === "checkout") {
    return `/checkout/podaci?auth=register&authError=${error}`;
  }
  return `/nalog/registracija?error=${error}&callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

export async function loginCustomerAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const remember = String(formData.get("remember") ?? "") === "true";
  const callbackUrl = customerCallback(
    String(formData.get("callbackUrl") ?? ""),
  );
  const surface = authSurface(formData);

  try {
    await signIn("credentials", {
      email,
      password,
      remember,
      redirect: true,
      redirectTo: callbackUrl,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const error: LoginErrorCode =
        err.type === "CredentialsSignin" || err.type === "CallbackRouteError"
          ? "invalid"
          : "generic";
      redirect(loginErrorUrl(error, callbackUrl, surface));
    }
    throw err;
  }
}

export async function registerCustomerAction(
  formData: FormData,
): Promise<void> {
  const callbackUrl = customerCallback(
    String(formData.get("callbackUrl") ?? ""),
  );
  const surface = authSurface(formData);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const marketingEmailConsent =
    formData.get("marketingEmailConsent") === "true";

  const requestHeaders = await headers();
  const limited = await checkRateLimit(
    rateLimitKey("registration", getClientIpFromHeaders(requestHeaders), email),
    RATE_LIMITS.registration,
  );
  if (!limited.ok) {
    redirect(registrationErrorUrl("rate_limited", callbackUrl, surface));
  }

  if (!emailPattern.test(email)) {
    redirect(registrationErrorUrl("invalid_email", callbackUrl, surface));
  }
  if (!isValidCustomerPassword(password)) {
    redirect(registrationErrorUrl("weak_password", callbackUrl, surface));
  }

  let registrationError: RegistrationErrorCode | null = null;

  try {
    const user = await registerCustomer({ email, password });
    if (marketingEmailConsent) {
      await setMarketingConsent(user.id, { email: true });
    }
    await sendEmailConfirmationForUser(user.id, {
      includeFirstPurchaseOffer: marketingEmailConsent,
    }).catch((err) => {
      console.error("[email] registration confirmation failed", err);
    });
  } catch (err) {
    registrationError =
      err instanceof Error && err.message === "EMAIL_TAKEN"
        ? "email_taken"
        : "generic";
  }

  if (registrationError) {
    redirect(registrationErrorUrl(registrationError, callbackUrl, surface));
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: true,
      redirectTo: callbackUrl,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      redirect(registrationErrorUrl("generic", callbackUrl, surface));
    }
    throw err;
  }
}
