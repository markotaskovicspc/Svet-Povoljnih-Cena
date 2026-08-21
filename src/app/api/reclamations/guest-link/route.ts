import { after, NextResponse } from "next/server";
import {
  guestReclamationLinkRequestSchema,
  issueGuestReclamationLink,
} from "@/lib/api/guest-reclamation-access";
import { processBackgroundJob } from "@/lib/background-jobs";
import { logOperationalError } from "@/lib/monitoring";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Always returns the same success response for validly shaped input. This keeps
 * order numbers, delivery state and guest e-mail addresses non-enumerable.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = guestReclamationLinkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const ipLimit = await checkRateLimitForRequest(
    req,
    "guest-reclamation-link:ip",
    RATE_LIMITS.guestReclamationLinkIp,
  );
  if (!ipLimit.ok) return rateLimitJson(ipLimit);

  const identityLimit = await checkRateLimitForRequest(
    req,
    "guest-reclamation-link:identity",
    RATE_LIMITS.guestReclamationLinkIdentity,
    [parsed.data.orderNumber, parsed.data.email],
  );
  if (!identityLimit.ok) return rateLimitJson(identityLimit);

  try {
    const issued = await issueGuestReclamationLink(parsed.data);
    if (issued) {
      after(async () => {
        try {
          const result = await processBackgroundJob(issued.jobId);
          if (result.claimed && !result.ok) {
            logOperationalError(
              "reclamation.guest_link_immediate_send_failed",
              new Error("Background job did not complete."),
              { jobId: issued.jobId, exhausted: result.exhausted },
            );
          }
        } catch (error) {
          logOperationalError(
            "reclamation.guest_link_immediate_send_crashed",
            error,
            { jobId: issued.jobId },
          );
        }
      });
    }
  } catch (error) {
    logOperationalError("reclamation.guest_link_issue_failed", error);
  }

  return NextResponse.json({ ok: true });
}
