"use client";

import { useActionState } from "react";
import {
  EMPTY_ADMIN_ACTION_STATE,
  type AdminActionState,
} from "@/lib/admin/action-state";
import { cn } from "@/lib/utils";

type AdminFormAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export function AdminActionForm({
  action,
  children,
  className,
}: {
  action: AdminFormAction;
  children: React.ReactNode | ((state: AdminActionState) => React.ReactNode);
  className?: string;
}) {
  const [state, formAction] = useActionState(
    action,
    EMPTY_ADMIN_ACTION_STATE,
  );
  const hasMessage = Boolean(state.message);

  return (
    <form action={formAction} className={className}>
      {hasMessage ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={cn(
            "mb-3 rounded-md border px-3 py-2 text-sm",
            state.ok
              ? "border-success/25 bg-success/10 text-success"
              : "border-destructive/25 bg-destructive/10 text-destructive",
          )}
        >
          {state.message}
        </p>
      ) : null}
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}
