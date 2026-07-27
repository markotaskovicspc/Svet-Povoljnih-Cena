export const REPORT_TIME_ZONE = "Europe/Belgrade";

export const REPORT_PERIOD_PRESETS = [
  { key: "today", label: "Danas", days: 1 },
  { key: "7d", label: "Poslednjih 7 dana", days: 7 },
  { key: "30d", label: "Poslednjih 30 dana", days: 30 },
  { key: "90d", label: "Poslednjih 90 dana", days: 90 },
  { key: "ytd", label: "Od početka godine", days: null },
] as const;

export type ReportPeriodPreset = (typeof REPORT_PERIOD_PRESETS)[number]["key"];

type ReportPeriodParams = {
  range?: string;
  from?: string;
  to?: string;
};

export type ReportPeriod = {
  preset: ReportPeriodPreset | "custom";
  fromInput: string;
  toInput: string;
  start: Date;
  endExclusive: Date;
  label: string;
};

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function resolveReportPeriod(
  params: ReportPeriodParams,
  now = new Date(),
): ReportPeriod {
  const today = dateInputInTimeZone(now);
  const customFrom = validDateInput(params.from);
  const customTo = validDateInput(params.to);

  if (params.range === "custom" && customFrom && customTo) {
    const [fromInput, toInput] =
      customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    return buildPeriod("custom", fromInput, toInput);
  }

  const preset = REPORT_PERIOD_PRESETS.find((item) => item.key === params.range) ??
    REPORT_PERIOD_PRESETS.find((item) => item.key === "30d")!;
  const fromInput =
    preset.key === "ytd"
      ? `${today.slice(0, 4)}-01-01`
      : addCalendarDays(today, -(preset.days - 1));

  return buildPeriod(preset.key, fromInput, today, preset.label);
}

export function dateInputInTimeZone(date: Date): string {
  const parts = dateParts(date, REPORT_TIME_ZONE);
  return `${parts.year}-${twoDigits(parts.month)}-${twoDigits(parts.day)}`;
}

function buildPeriod(
  preset: ReportPeriod["preset"],
  fromInput: string,
  toInput: string,
  presetLabel?: string,
): ReportPeriod {
  return {
    preset,
    fromInput,
    toInput,
    start: businessDayStart(fromInput),
    endExclusive: businessDayStart(addCalendarDays(toInput, 1)),
    label:
      presetLabel ??
      (fromInput === toInput
        ? formatDateInput(fromInput)
        : `${formatDateInput(fromInput)} – ${formatDateInput(toInput)}`),
  };
}

function validDateInput(value?: string): string | undefined {
  if (!value || !DATE_INPUT_PATTERN.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return undefined;
  }
  return value;
}

function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

function businessDayStart(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day);
  let candidate = new Date(localAsUtc);

  // Convert a Belgrade wall-clock midnight into its UTC instant. Rechecking the
  // offset keeps this correct on dates near daylight-saving transitions.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = timeZoneOffsetMs(candidate, REPORT_TIME_ZONE);
    candidate = new Date(localAsUtc - offset);
  }
  return candidate;
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = dateParts(date, timeZone, true);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function dateParts(date: Date, timeZone: string, includeTime = false) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime
      ? {
          hour: "2-digit" as const,
          minute: "2-digit" as const,
          second: "2-digit" as const,
          hourCycle: "h23" as const,
        }
      : {}),
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function formatDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}
