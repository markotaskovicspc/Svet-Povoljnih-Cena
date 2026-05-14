export type AdminActionFieldErrors = Record<string, string[]>;

export type AdminActionState<T = unknown> = {
  ok: boolean;
  message: string;
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
): AdminActionState<T> {
  return { ok: true, message, result };
}

export function adminActionError<T = unknown>(
  message = "Nešto nije u redu. Pokušajte ponovo.",
  fieldErrors?: AdminActionFieldErrors,
): AdminActionState<T> {
  return { ok: false, message, fieldErrors };
}
