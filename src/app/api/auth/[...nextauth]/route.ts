import { handlers } from "@/lib/auth/auth";
import type { NextRequest } from "next/server";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const GET = handlers.GET;

export async function POST(req: NextRequest) {
  const limited = checkRateLimitForRequest(req, "auth:post", RATE_LIMITS.login);
  if (!limited.ok) {
    return rateLimitJson(limited, "Previše pokušaja prijave. Pokušajte kasnije.");
  }
  return handlers.POST(req);
}
