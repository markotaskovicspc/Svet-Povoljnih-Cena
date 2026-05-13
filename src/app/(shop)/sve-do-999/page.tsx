import type { Metadata } from "next";
import { ListingShell } from "@/components/listing/listing-shell";
import { upTo999 } from "@/data/products";

export const metadata: Metadata = {
  title: "Sve do 999",
  description:
    "Praktični dodaci i sitnice za dom po ceni do 999 RSD.",
};

export default function SveDo999Page() {
  return (
    <ListingShell
      kind="akcija"
      title="Sve do 999"
      subtitle="Mali dodaci za dom i nameštaj u najnižem cenovnom rangu."
      trail={[{ label: "Sve do 999" }]}
      source={upTo999()}
    />
  );
}
