export const CART_DRAWER_RETURN_PARAM = "spcCart";
const CART_DRAWER_RETURN_VALUE = "open";

export function cartDrawerLoginReturnPath(
  pathname: string,
  queryString = "",
): string {
  const params = new URLSearchParams(
    queryString.startsWith("?") ? queryString.slice(1) : queryString,
  );
  params.set(CART_DRAWER_RETURN_PARAM, CART_DRAWER_RETURN_VALUE);
  return `${pathname}?${params.toString()}`;
}

export function consumeCartDrawerReturnMarker(rawUrl: string): string | null {
  const url = new URL(rawUrl, "https://svet-povoljnih-cena.local");
  if (
    url.searchParams.get(CART_DRAWER_RETURN_PARAM) !==
    CART_DRAWER_RETURN_VALUE
  ) {
    return null;
  }

  url.searchParams.delete(CART_DRAWER_RETURN_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}
