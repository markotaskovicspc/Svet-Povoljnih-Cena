export type ShipmentAssignment = {
  orderItemIds: string[];
  codAmount: number;
};

export function normalizeOrderItemIds(values: readonly string[] | undefined) {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ).sort();
}

export function readShipmentAssignment(raw: unknown): ShipmentAssignment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const assignment = (raw as Record<string, unknown>).assignment;
  if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) {
    return null;
  }
  const value = assignment as Record<string, unknown>;
  if (!Array.isArray(value.orderItemIds)) return null;
  const orderItemIds = normalizeOrderItemIds(
    value.orderItemIds.filter((item): item is string => typeof item === "string"),
  );
  if (!orderItemIds.length) return null;
  const codAmount = Number(value.codAmount ?? 0);
  return {
    orderItemIds,
    codAmount: Number.isFinite(codAmount) && codAmount >= 0 ? codAmount : 0,
  };
}

export function withShipmentAssignment(
  providerResponse: unknown,
  assignment: ShipmentAssignment,
) {
  const base =
    providerResponse &&
    typeof providerResponse === "object" &&
    !Array.isArray(providerResponse)
      ? { ...(providerResponse as Record<string, unknown>) }
      : { providerResponse: providerResponse ?? null };
  return {
    ...base,
    assignment: {
      orderItemIds: normalizeOrderItemIds(assignment.orderItemIds),
      codAmount:
        Number.isFinite(assignment.codAmount) && assignment.codAmount >= 0
          ? assignment.codAmount
          : 0,
    },
  };
}

export function sameShipmentAssignment(
  raw: unknown,
  orderItemIds: readonly string[],
) {
  const existing = readShipmentAssignment(raw);
  const requested = normalizeOrderItemIds(orderItemIds);
  return (
    existing != null &&
    existing.orderItemIds.length === requested.length &&
    existing.orderItemIds.every((id, index) => id === requested[index])
  );
}

/**
 * Splits one order total between provider-specific item groups without ever
 * charging the order total twice. The final group receives the rounding
 * remainder, so all returned amounts always add up to the original total.
 */
export function splitAmountByWeights(
  total: number,
  orderedGroups: readonly { key: string; weight: number }[],
) {
  const normalizedTotal = money(total);
  const groups = orderedGroups.map((group) => ({
    key: group.key,
    weight: Math.max(0, Number.isFinite(group.weight) ? group.weight : 0),
  }));
  const result = new Map<string, number>();
  if (!groups.length) return result;
  const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
  let allocated = 0;
  groups.forEach((group, index) => {
    const amount =
      index === groups.length - 1
        ? money(normalizedTotal - allocated)
        : money(
            totalWeight > 0
              ? (normalizedTotal * group.weight) / totalWeight
              : normalizedTotal / groups.length,
          );
    allocated = money(allocated + amount);
    result.set(group.key, amount);
  });
  return result;
}

function money(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}
