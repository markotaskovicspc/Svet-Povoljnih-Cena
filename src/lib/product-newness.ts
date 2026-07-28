export function productNewUntilIsActive(
  newUntil: Date | null | undefined,
  now = new Date(),
) {
  if (!newUntil) return false;
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  return newUntil >= today;
}

export function productNewUntilFloor(now = new Date()) {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  return today;
}
