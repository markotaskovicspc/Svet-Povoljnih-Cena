"use client";

import { Suspense, type ComponentProps } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { gridReturnHref } from "@/lib/admin/grid-return";

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

function ReturnLink({ href, ...props }: Props) {
  const search = useSearchParams();
  return <Link {...props} href={gridReturnHref(search?.get("returnTo"), href)} />;
}

export function GridReturnLink(props: Props) {
  return <Suspense fallback={<Link {...props} />}><ReturnLink {...props} /></Suspense>;
}
