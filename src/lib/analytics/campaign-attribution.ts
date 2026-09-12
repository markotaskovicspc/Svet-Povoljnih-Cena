"use client";

// Called only after analytics consent has been checked.
const TRAFFIC_KEY = "spc:ar-traffic-v1";
export function captureCampaign() {
  const empty = { source: "direct", medium: "", campaign: "", content: "" };
  try {
    const query = new URLSearchParams(location.search);
    if (["utm_source", "utm_medium", "utm_campaign", "utm_content"].some(key => query.has(key))) {
      const value = { source: query.get("utm_source")?.slice(0, 120) || "direct", medium: query.get("utm_medium")?.slice(0, 120) || "", campaign: query.get("utm_campaign")?.slice(0, 120) || "", content: query.get("utm_content")?.slice(0, 120) || "" };
      sessionStorage.setItem(TRAFFIC_KEY, JSON.stringify(value));
      return value;
    }
    const saved = JSON.parse(sessionStorage.getItem(TRAFFIC_KEY) || "{}");
    for (const key of ["source", "medium", "campaign", "content"] as const) {
      if (typeof saved?.[key] === "string") empty[key] = saved[key].slice(0, 120);
    }
    return empty;
  } catch { return empty; }
}
