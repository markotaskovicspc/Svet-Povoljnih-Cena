export function PickingBarcode({ value }: { value: string | null }) {
  return <strong className="whitespace-nowrap font-mono font-bold">{value || "—"}</strong>;
}
