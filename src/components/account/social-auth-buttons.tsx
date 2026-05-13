import { CircleUserRound } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SocialAuthAction = (formData: FormData) => Promise<void>;

type SocialAuthProvider = {
  id: "google" | "facebook" | "apple";
  label: string;
  action: SocialAuthAction;
};

type SocialAuthActions = Record<SocialAuthProvider["id"], SocialAuthAction>;

export function getConfiguredSocialAuthProviders(
  actions: SocialAuthActions,
): SocialAuthProvider[] {
  const providers: SocialAuthProvider[] = [];

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push({ id: "google", label: "Google", action: actions.google });
  }
  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    providers.push({
      id: "facebook",
      label: "Facebook",
      action: actions.facebook,
    });
  }
  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
    providers.push({ id: "apple", label: "Apple", action: actions.apple });
  }

  return providers;
}

export function SocialAuthButtons({
  callbackUrl,
  intent,
  providers,
}: {
  callbackUrl: string;
  intent: "login" | "register";
  providers: SocialAuthProvider[];
}) {
  if (!providers.length) return null;

  const actionLabel = intent === "register" ? "Registrujte se" : "Prijavite se";

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-ink-400">
        <span className="h-px flex-1 bg-border" />
        ili
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-2">
        {providers.map((provider) => (
          <form key={provider.id} action={provider.action}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button
              type="submit"
              aria-label={`${actionLabel} preko ${provider.label}`}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 w-full gap-2 bg-white",
              )}
            >
              <CircleUserRound className="size-4" aria-hidden />
              {actionLabel} uz {provider.label}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
