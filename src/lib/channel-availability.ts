export const CHANNEL_SAFETY_STOCK = {
  web: 0,
  wholesale: 10,
  export: 20,
} as const;

export function resolveChannelAvailability(input: {
  physical: number;
  reserved?: number;
  manualWeb: boolean;
  manualWholesale: boolean;
  manualExport: boolean;
}) {
  const available = Math.max(input.physical - (input.reserved ?? 0), 0);
  return {
    available,
    web: input.manualWeb && available > CHANNEL_SAFETY_STOCK.web,
    wholesale:
      input.manualWholesale && available > CHANNEL_SAFETY_STOCK.wholesale,
    export: input.manualExport && available > CHANNEL_SAFETY_STOCK.export,
  };
}
