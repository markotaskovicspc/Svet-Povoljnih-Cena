import Image from "next/image";
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

export function SocialProviderMark({ id }: { id: SocialAuthProvider["id"] }) {
  return (
    <Image
      src={`/icons/${id}.svg`}
      alt=""
      aria-hidden="true"
      width={20}
      height={20}
      className="size-5 shrink-0"
    />
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
      <SocialProviderMark id={provider.id} />
      {actionLabel} uz {provider.label}
    </>
  );
}

export function SocialAuthButtons({
  callbackUrl,
  intent,
  providers,
  showDivider = true,
}: {
  callbackUrl: string;
  intent: "login" | "register";
  providers: SocialAuthProvider[];
  showDivider?: boolean;
}) {
  if (!providers.length) return null;

  const actionLabel = intent === "register" ? "Registrujte se" : "Prijavite se";

  return (
    <div className="mt-6 space-y-3">
      {showDivider ? (
        <div className="flex items-center gap-3 text-xs tracking-[0.18em] text-ink-400 uppercase">
          <span className="h-px flex-1 bg-border" />
          ili
          <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}
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
              aria-label={`${actionLabel} preko ${provider.label} nije dostupno`}
              title={`${provider.label} prijava nije konfigurisana`}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 w-full cursor-not-allowed gap-2 bg-white opacity-60",
              )}
            >
              <SocialButtonContent
                actionLabel={actionLabel}
                provider={provider}
              />
              <span className="ml-auto text-[11px] text-ink-500">
                Nije dostupno
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
