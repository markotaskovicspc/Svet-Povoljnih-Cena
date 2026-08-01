export const ARTICLE_STATUS_OPTIONS = [
  { value: "SP", label: "SP — aktivan artikal" },
  { value: "IT", label: "IT — aktivan, ograničena ponuda" },
  { value: "DTZ", label: "DTZ — Dok traju zalihe" },
  { value: "DOB", label: "DOB — aktivan dobavljački artikal" },
  { value: "ARH", label: "ARH — arhiviran" },
  { value: "UZ", label: "UZ — neaktivan / u pripremi" },
] as const;

export const ARTICLE_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  ARTICLE_STATUS_OPTIONS.map(({ value, label }) => [value, label]),
);
