import type { NavNode } from "@/data/site";
import type { CategoryNode } from "@/lib/api/catalog";

/** Imported slugs can include parent names; the stored path is canonical. */
export function categoryNav(nodes: CategoryNode[]): NavNode[] {
  return nodes.map((node) => ({
    label: node.name,
    href: `/k${node.path}`,
    imageUrl: node.imageUrl,
    children: node.children.length ? categoryNav(node.children) : undefined,
  }));
}
