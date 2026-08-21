export function customerCallback(raw?: string | string[]) {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/nalog";
  }
  if (value.startsWith("/admin")) return "/nalog";
  if (value.startsWith("/nalog/prijava")) return "/nalog";
  if (value.startsWith("/nalog/registracija")) return "/nalog";

  return value;
}

export function customerLoginHref(returnTo?: string | string[]) {
  const callbackUrl = customerCallback(returnTo);
  return `/nalog/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
