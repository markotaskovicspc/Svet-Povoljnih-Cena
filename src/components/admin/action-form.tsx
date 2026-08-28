"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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

type NativeFormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isNativeFormControl(element: Element): element is NativeFormControl {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

function controlLabel(control: NativeFormControl) {
  const explicitLabel = control.getAttribute("aria-label")?.trim();
  if (explicitLabel) return explicitLabel;

  const label = control.labels?.[0];
  if (label) {
    const copy = label.cloneNode(true) as HTMLLabelElement;
    copy
      .querySelectorAll("input, select, textarea, button, p, small")
      .forEach((element) => element.remove());
    const text = copy.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }

  return control.name || "Polje";
}

function nativeValidationMessage(form: HTMLFormElement) {
  const invalidLabels = Array.from(form.elements)
    .filter(isNativeFormControl)
    .filter((control) => control.willValidate && !control.validity.valid)
    .map(controlLabel)
    .filter((label, index, labels) => labels.indexOf(label) === index);

  if (invalidLabels.length === 0) return "";
  if (invalidLabels.length === 1) {
    return `Popunite obavezno polje pre čuvanja: ${invalidLabels[0]}.`;
  }
  return `Popunite obavezna polja pre čuvanja: ${invalidLabels.join(", ")}.`;
}

export function AdminActionForm({
  action,
  children,
  className,
  id,
  preserveValues = false,
  refreshOnSuccess = false,
  successPopupUrl,
  popupWindowName,
  testId,
}: {
  action: AdminFormAction;
  children: React.ReactNode | ((state: AdminActionState) => React.ReactNode);
  className?: string;
  id?: string;
  preserveValues?: boolean;
  refreshOnSuccess?: boolean;
  successPopupUrl?: string;
  popupWindowName?: string;
  testId?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(
    action,
    EMPTY_ADMIN_ACTION_STATE,
  );
  const [clientValidationMessage, setClientValidationMessage] = useState("");
  const [validationFocusRequest, setValidationFocusRequest] = useState(0);
  const refreshedState = useRef(state);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const successPopupRef = useRef<Window | null>(null);
  const popupHandledState = useRef(state);
  const message = clientValidationMessage || state.message;
  const messageIsSuccess = !clientValidationMessage && Boolean(state.message) && state.ok;
  const messageIsWarning = messageIsSuccess && state.tone === "warning";
  const hasMessage = Boolean(message);

  useEffect(() => {
    if (!refreshOnSuccess || !state.ok || refreshedState.current === state) return;
    refreshedState.current = state;
    window.dispatchEvent(new Event("spc:erp-grid-refresh"));
    router.refresh();
  }, [refreshOnSuccess, router, state]);

  useEffect(() => {
    if (!successPopupUrl || popupHandledState.current === state) return;
    popupHandledState.current = state;
    const popup = successPopupRef.current;
    successPopupRef.current = null;
    if (!popup) return;
    if (state.ok) {
      popup.location.assign(successPopupUrl);
    } else {
      popup.close();
    }
  }, [state, successPopupUrl]);

  useEffect(() => {
    if (!state.message) return;
    const frame = window.requestAnimationFrame(() => {
      messageRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state]);

  useEffect(() => {
    if (validationFocusRequest === 0) return;
    const frame = window.requestAnimationFrame(() => {
      messageRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [validationFocusRequest]);

  return (
    <form
      action={formAction}
      className={className}
      id={id}
      data-testid={testId}
      onSubmit={() => {
        if (!successPopupUrl) return;
        const popup = window.open(
          "about:blank",
          popupWindowName ?? "admin-action-print",
        );
        if (!popup) return;
        popup.document.title = "Priprema štampe…";
        popup.document.body.innerHTML =
          '<p style="font:16px system-ui;padding:24px">Priprema dokumenta za štampu…</p>';
        successPopupRef.current = popup;
      }}
      onReset={
        preserveValues
          ? (event) => {
              event.preventDefault();
            }
          : undefined
      }
      onInvalid={(event) => {
        setClientValidationMessage(nativeValidationMessage(event.currentTarget));
        setValidationFocusRequest((current) => current + 1);
      }}
      onInput={(event) => {
        if (!clientValidationMessage) return;
        setClientValidationMessage(nativeValidationMessage(event.currentTarget));
      }}
    >
      {hasMessage ? (
        <p
          ref={messageRef}
          role={messageIsSuccess ? "status" : "alert"}
          tabIndex={-1}
          className={cn(
            "mb-3 scroll-mt-6 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40",
            messageIsWarning
              ? "border-warning/25 bg-warning/10 text-warning"
              : messageIsSuccess
              ? "border-success/25 bg-success/10 text-success"
              : "border-destructive/25 bg-destructive/10 text-destructive",
          )}
        >
          {message}
        </p>
      ) : null}
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}
