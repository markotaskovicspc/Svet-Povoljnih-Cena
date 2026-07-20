"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export const DEFAULT_DESTRUCTIVE_CONFIRMATION =
  "Potvrdite destruktivnu akciju. Ova promena može biti nepovratna.";

export function getSubmitConfirmation(
  confirm: string | undefined,
  variant: React.ComponentProps<typeof Button>["variant"],
) {
  return (
    confirm ??
    (variant === "destructive" ? DEFAULT_DESTRUCTIVE_CONFIRMATION : undefined)
  );
}

type SubmitButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "type"
> & {
  pendingLabel?: string;
  confirm?: string;
};

export function SubmitButton({
  children,
  pendingLabel,
  variant,
  confirm,
  disabled,
  onClick,
  ...buttonProps
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const confirmation = getSubmitConfirmation(confirm, variant);

  return (
    <Button
      {...buttonProps}
      type="submit"
      disabled={pending || disabled}
      variant={variant}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (confirmation && !window.confirm(confirmation)) {
          event.preventDefault();
        }
      }}
    >
      {pending ? (pendingLabel ?? "Čuvanje…") : children}
    </Button>
  );
}
