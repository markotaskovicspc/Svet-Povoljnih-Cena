import "server-only";

import { envValue } from "@/lib/env";
import type {
  SocialAuthAction,
  SocialAuthProvider,
} from "@/components/account/social-auth-buttons";

type SocialAuthActions = Record<SocialAuthProvider["id"], SocialAuthAction>;

const labels: Record<SocialAuthProvider["id"], string> = {
  google: "Google",
  facebook: "Facebook",
  apple: "Apple",
};

function configured(provider: SocialAuthProvider["id"]) {
  const prefix = provider.toUpperCase();
  return Boolean(
    (envValue(`${prefix}_CLIENT_ID`) ?? envValue(`AUTH_${prefix}_ID`)) &&
    (envValue(`${prefix}_CLIENT_SECRET`) ?? envValue(`AUTH_${prefix}_SECRET`)),
  );
}

export function getConfiguredSocialAuthProviders(
  actions: SocialAuthActions,
  options: { includeUnavailable?: boolean } = {},
): SocialAuthProvider[] {
  return (["google", "apple", "facebook"] as const).flatMap((id) => {
    const available = configured(id);
    if (!available && !options.includeUnavailable) return [];
    return [{ id, label: labels[id], action: available ? actions[id] : undefined }];
  });
}
