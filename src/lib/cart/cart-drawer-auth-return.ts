export const CART_DRAWER_RETURN_PARAM = "spcCart";
const CART_DRAWER_RETURN_VALUE = "open";

export function cartDrawerLoginReturnPath(
  pathname: string,
  queryString = "",
  hash = "",
): string {
  const params = new URLSearchParams(
    queryString.startsWith("?") ? queryString.slice(1) : queryString,
  );
  params.set(CART_DRAWER_RETURN_PARAM, CART_DRAWER_RETURN_VALUE);
  const normalizedHash = hash && !hash.startsWith("#") ? `#${hash}` : hash;
  return `${pathname}?${params.toString()}${normalizedHash}`;
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
