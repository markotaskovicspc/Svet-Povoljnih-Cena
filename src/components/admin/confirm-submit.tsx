"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Submit button that asks for native confirmation before submitting the form.
 * Used for destructive admin actions (spec: brisanje uvek traži potvrdu).
 */
export function ConfirmSubmitButton({
  children,
  confirm,
  pendingLabel,
  className,
  variant = "destructive",
  size,
}: {
  children: React.ReactNode;
  confirm: string;
  pendingLabel?: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      variant={variant}
      size={size}
      className={cn(className)}
      onClick={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? (pendingLabel ?? "…") : children}
    </Button>
  );
}
