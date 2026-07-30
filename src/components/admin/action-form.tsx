"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
  id,
  refreshOnSuccess = false,
  testId,
}: {
  action: AdminFormAction;
  children: React.ReactNode | ((state: AdminActionState) => React.ReactNode);
  className?: string;
  id?: string;
  refreshOnSuccess?: boolean;
  testId?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    action,
    EMPTY_ADMIN_ACTION_STATE,
  );
  const refreshedState = useRef(state);
  const hasMessage = Boolean(state.message);

  useEffect(() => {
    if (!refreshOnSuccess || !state.ok || refreshedState.current === state) return;
    refreshedState.current = state;
    window.dispatchEvent(new Event("spc:erp-grid-refresh"));
    router.refresh();
  }, [refreshOnSuccess, router, state]);

  return (
    <form action={formAction} className={className} id={id} data-testid={testId}>
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
