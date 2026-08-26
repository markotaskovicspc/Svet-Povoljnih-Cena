import { createHash } from "node:crypto";

export function normalizeWebCustomerEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

export function normalizeWebCustomerPhone(value: string | null | undefined) {
  return value?.replace(/[^0-9+]/g, "") || null;
}

export function webCustomerIdentity(input: {
  email?: string | null;
  phone?: string | null;
}) {
  return (
    normalizeWebCustomerEmail(input.email) ??
    normalizeWebCustomerPhone(input.phone)
  );
}

export function webGuestCustomerId(identity: string) {
  return `erp-customer-guest-${md5(identity)}`;
}

export function webUserCustomerId(userId: string) {
  return `erp-customer-user-${md5(userId)}`;
}

function md5(value: string) {
  return createHash("md5").update(value, "utf8").digest("hex");
}
