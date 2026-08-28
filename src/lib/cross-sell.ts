export function getCrossSellContinueLabel(destination: string | null) {
  return destination?.startsWith("/checkout")
    ? "Nastavi na plaćanje"
    : "Nastavi ka korpi";
}
