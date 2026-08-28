export type AdminActionFieldErrors = Record<string, string[]>;

export type AdminActionState<T = unknown> = {
  ok: boolean;
  message: string;
  tone?: "success" | "warning";
  fieldErrors?: AdminActionFieldErrors;
  result?: T;
};

export const EMPTY_ADMIN_ACTION_STATE: AdminActionState = {
  ok: false,
  message: "",
};

export function adminActionSuccess<T = unknown>(
  message = "Sačuvano.",
  result?: T,
  tone: "success" | "warning" = "success",
): AdminActionState<T> {
  return { ok: true, message, result, tone };
}

export function adminActionError<T = unknown>(
  message = "Nešto nije u redu. Pokušajte ponovo.",
  fieldErrors?: AdminActionFieldErrors,
): AdminActionState<T> {
  return { ok: false, message, fieldErrors };
}
