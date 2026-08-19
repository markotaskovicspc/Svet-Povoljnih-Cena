import type { NavNode } from "@/data/site";

export function getCategoryMenuAction(
  node: Pick<NavNode, "children">,
): "submenu" | "link" {
  return node.children?.length ? "submenu" : "link";
}
