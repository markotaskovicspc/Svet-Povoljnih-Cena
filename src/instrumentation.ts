import type { Instrumentation } from "next";
import { redactText } from "@/lib/monitoring";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const path = request.path.split("?")[0] ?? request.path;
  const normalized = error instanceof Error
    ? { name: error.name, message: error.message, digest: "digest" in error ? String(error.digest ?? "") : undefined }
    : { name: "UnknownError", message: String(error), digest: undefined };
  console.error("[request-error]", JSON.stringify({
    name: normalized.name,
    message: redactText(normalized.message),
    digest: normalized.digest,
    method: request.method,
    path,
    routePath: context.routePath,
    routeType: context.routeType,
    timestamp: new Date().toISOString(),
  }));
};
