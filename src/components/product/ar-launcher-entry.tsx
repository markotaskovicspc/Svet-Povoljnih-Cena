"use client";
import dynamic from "next/dynamic";
import type { ProductArAsset } from "@/types";
const ArLauncher = dynamic(() => import("./ar-launcher"), {
  ssr: false,
  loading: () => <p role="status">Priprema AR prikaza…</p>,
});
export default function ArLauncherEntry(props: { asset: ProductArAsset; productPath: string }) {
  return <ArLauncher {...props} />;
}
