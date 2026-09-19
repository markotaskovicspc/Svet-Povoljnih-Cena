// Keep existing audience IDs and filters intact, including historical snapshots.
const testAudienceNames: Record<string, string> = {
  "QA Browser opt-in 2026-08-20": "TEST — provera newsletter prijave",
  "QA Browser main domen 2026-08-20": "TEST — provera glavnog domena",
};

export function newsletterAudienceLabel(name: string) {
  return testAudienceNames[name] ?? name;
}

export function isNewsletterTestAudience(name: string) {
  return Object.hasOwn(testAudienceNames, name) || Object.values(testAudienceNames).includes(name);
}
