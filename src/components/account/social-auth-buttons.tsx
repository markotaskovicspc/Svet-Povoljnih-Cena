import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SocialAuthAction = (formData: FormData) => Promise<void>;

type SocialAuthProvider = {
  id: "google" | "facebook" | "apple";
  label: string;
  action?: SocialAuthAction;
};

type SocialAuthActions = Record<SocialAuthProvider["id"], SocialAuthAction>;

const socialProviderLabels: Record<SocialAuthProvider["id"], string> = {
  google: "Google",
  facebook: "Facebook",
  apple: "Apple",
};

export function getConfiguredSocialAuthProviders(
  actions: SocialAuthActions,
  options: { includeUnavailable?: boolean } = {},
): SocialAuthProvider[] {
  const providers: SocialAuthProvider[] = [];

  const addProvider = (id: SocialAuthProvider["id"], configured: boolean) => {
    if (!configured && !options.includeUnavailable) return;
    providers.push({
      id,
      label: socialProviderLabels[id],
      action: configured ? actions[id] : undefined,
    });
  };

  addProvider(
    "google",
    Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  );
  addProvider(
    "apple",
    Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET),
  );
  addProvider(
    "facebook",
    Boolean(
      process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET,
    ),
  );

  return providers;
}

function ProviderMark({ id }: { id: SocialAuthProvider["id"] }) {
  const mark = id === "facebook" ? "f" : id === "apple" ? "A" : "G";

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-full text-xs font-bold",
        id === "google" && "bg-white text-ink-900 ring-1 ring-border",
        id === "apple" && "bg-ink-900 text-white",
        id === "facebook" && "bg-[#1877f2] text-white",
      )}
    >
      {mark}
    </span>
  );
}

function SocialButtonContent({
  actionLabel,
  provider,
}: {
  actionLabel: string;
  provider: SocialAuthProvider;
}) {
  return (
    <>
      <ProviderMark id={provider.id} />
      {actionLabel} uz {provider.label}
    </>
  );
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
      <div className="flex items-center gap-3 text-xs tracking-[0.18em] text-ink-400 uppercase">
        <span className="h-px flex-1 bg-border" />
        ili
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-2">
        {providers.map((provider) =>
          provider.action ? (
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
                <SocialButtonContent
                  actionLabel={actionLabel}
                  provider={provider}
                />
              </button>
            </form>
          ) : (
            <button
              key={provider.id}
              type="button"
              aria-disabled="true"
              aria-label={`${actionLabel} preko ${provider.label}`}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 w-full cursor-default gap-2 bg-white",
              )}
            >
              <SocialButtonContent
                actionLabel={actionLabel}
                provider={provider}
              />
            </button>
          ),
        )}
      </div>
    </div>
  );
}
