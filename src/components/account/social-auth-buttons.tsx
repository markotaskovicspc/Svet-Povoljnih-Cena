import Image from "next/image";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SocialAuthAction = (formData: FormData) => Promise<void>;

export type SocialAuthProvider = {
  id: "google" | "facebook" | "apple";
  label: string;
  action?: SocialAuthAction;
};

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
    <div className="mt-4 space-y-2 md:mt-6 md:space-y-3">
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
                  "h-10 w-full gap-2 bg-white md:h-11",
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
                "h-10 w-full cursor-not-allowed gap-2 bg-white opacity-60 md:h-11",
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
