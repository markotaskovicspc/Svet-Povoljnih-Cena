import Link from "next/link";

import {
  SocialAuthButtons,
  type SocialAuthProvider,
} from "@/components/account/social-auth-buttons";
import {
  CustomerLoginFields,
  LoginError,
  type LoginErrorCode,
} from "@/app/(account)/nalog/prijava/form";
import {
  CustomerRegistrationFields,
  RegistrationError,
  type RegistrationErrorCode,
} from "@/app/(account)/nalog/registracija/form";

export type CustomerAuthFormAction = (formData: FormData) => Promise<void>;

export function CustomerAuthMethods({
  callbackUrl,
  intent,
  providers,
  loginAction,
  registrationAction,
  surface = "account",
  loginError,
  registrationError,
}: {
  callbackUrl: string;
  intent: "login" | "register";
  providers: SocialAuthProvider[];
  loginAction: CustomerAuthFormAction;
  registrationAction: CustomerAuthFormAction;
  surface?: "account" | "checkout";
  loginError?: LoginErrorCode;
  registrationError?: RegistrationErrorCode;
}) {
  return (
    <>
      {intent === "login" ? (
        <LoginError error={loginError} />
      ) : (
        <RegistrationError error={registrationError} />
      )}

      <SocialAuthButtons
        callbackUrl={callbackUrl}
        intent={intent}
        providers={providers}
        showDivider={false}
      />

      <div className="mt-4 flex items-center gap-3 text-[11px] tracking-[0.14em] text-ink-400 uppercase md:mt-6 md:text-xs md:tracking-[0.18em]">
        <span className="h-px flex-1 bg-border" />
        ili nastavite e-poštom
        <span className="h-px flex-1 bg-border" />
      </div>

      {intent === "login" ? (
        <>
          <form action={loginAction} className="mt-4 md:mt-5">
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <input type="hidden" name="authSurface" value={surface} />
            <CustomerLoginFields autoFocus={surface === "account"} />
          </form>
          <Link
            href="/nalog/lozinka/zaboravljena"
            className="mt-3 inline-flex w-full justify-center text-sm font-medium text-walnut hover:underline"
          >
            Zaboravili ste lozinku?
          </Link>
        </>
      ) : (
        <form action={registrationAction} className="mt-5">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <input type="hidden" name="authSurface" value={surface} />
          <CustomerRegistrationFields autoFocus={surface === "account"} />
        </form>
      )}
    </>
  );
}
