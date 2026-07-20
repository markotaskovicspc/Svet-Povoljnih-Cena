export const DEFAULT_GA4_MEASUREMENT_ID = "G-7L6BDSRM0P";

export function getGa4MeasurementId(
  configuredId = process.env.NEXT_PUBLIC_GA4_ID,
) {
  return configuredId?.startsWith("G-")
    ? configuredId
    : DEFAULT_GA4_MEASUREMENT_ID;
}
