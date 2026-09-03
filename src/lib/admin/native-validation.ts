export type NativeValidationIssue = {
  label: string;
  valueMissing?: boolean;
  rangeOverflow?: boolean;
  rangeUnderflow?: boolean;
  stepMismatch?: boolean;
  tooLong?: boolean;
  tooShort?: boolean;
  typeMismatch?: boolean;
  patternMismatch?: boolean;
  badInput?: boolean;
  customError?: boolean;
  min?: string | null;
  max?: string | null;
  step?: string | null;
  minLength?: number;
  maxLength?: number;
  nativeMessage?: string | null;
};

function quoted(label: string) {
  return `„${label}”`;
}

function displayConstraint(value: string | null | undefined) {
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return new Intl.NumberFormat("sr-Latn-RS", {
    maximumFractionDigits: 20,
  }).format(number);
}

export function nativeValidationIssueMessage(issue: NativeValidationIssue) {
  const label = quoted(issue.label);
  const min = displayConstraint(issue.min);
  const max = displayConstraint(issue.max);
  const step = displayConstraint(issue.step);

  if (issue.valueMissing) return `Popunite obavezno polje: ${label}.`;
  if (issue.badInput) return `Unesite ispravnu brojčanu vrednost za polje ${label}.`;
  if (issue.rangeOverflow && max) {
    return `Vrednost polja ${label} mora biti najviše ${max}.`;
  }
  if (issue.rangeUnderflow && min) {
    return `Vrednost polja ${label} mora biti najmanje ${min}.`;
  }
  if (issue.stepMismatch) {
    return step && step !== "any"
      ? `Vrednost polja ${label} mora biti uneta u koracima od ${step}.`
      : `Unesite dozvoljenu vrednost za polje ${label}.`;
  }
  if (issue.tooLong && issue.maxLength != null && issue.maxLength >= 0) {
    return `Polje ${label} može imati najviše ${issue.maxLength} znakova.`;
  }
  if (issue.tooShort && issue.minLength != null && issue.minLength >= 0) {
    return `Polje ${label} mora imati najmanje ${issue.minLength} znakova.`;
  }
  if (issue.typeMismatch) return `Vrednost polja ${label} nije u ispravnom formatu.`;
  if (issue.patternMismatch) return `Vrednost polja ${label} nije u dozvoljenom formatu.`;
  if (issue.customError && issue.nativeMessage?.trim()) {
    return issue.nativeMessage.trim();
  }
  return `Proverite vrednost polja ${label}.`;
}

export function nativeValidationSummary(issues: NativeValidationIssue[]) {
  if (issues.length === 0) return "";

  const uniqueIssues = issues.filter(
    (issue, index) =>
      issues.findIndex((candidate) => candidate.label === issue.label) === index,
  );
  if (uniqueIssues.every((issue) => issue.valueMissing)) {
    const labels = uniqueIssues.map((issue) => quoted(issue.label));
    return labels.length === 1
      ? `Popunite obavezno polje: ${labels[0]}.`
      : `Popunite obavezna polja: ${labels.join(", ")}.`;
  }

  return uniqueIssues.map(nativeValidationIssueMessage).join(" ");
}
