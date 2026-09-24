import "server-only";
import { cookies } from "next/headers";
import { LOYALTY_COOKIE, loyaltyMemberForSession } from "./service.server";

export async function getGuestLoyaltyMember() {
  return loyaltyMemberForSession((await cookies()).get(LOYALTY_COOKIE)?.value);
}
