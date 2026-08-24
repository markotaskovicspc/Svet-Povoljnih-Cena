import Image from "next/image";
import Link from "next/link";
import type { NavNode } from "@/data/site";
import { getCategoryMenuAction } from "./category-menu-action";
import { getCategoryMenuImage } from "./category-menu-image";

export function CategoryMenuGrid({
  categories,
  onEnter,
  onNavigate,
}: {
  categories: NavNode[];
  onEnter: (node: NavNode) => void;
  onNavigate: () => void;
}) {
  return (
    <div
      data-slot="category-menu-grid"
      className="shrink-0 bg-white px-[clamp(10px,3.2vw,14px)] pt-3 pb-[clamp(24px,7vw,34px)]"
    >
      <ul className="grid grid-cols-2 gap-x-[clamp(10px,3.2vw,14px)] gap-y-[clamp(24px,7vw,32px)]">
        {categories.map((node) => {
          const tileContent = (
            <>
              <span className="relative block aspect-[1.45/1] w-full overflow-hidden rounded-md bg-muted-bg">
                <Image
                  src={getCategoryMenuImage(node)}
                  alt=""
                  fill
                  sizes="(max-width: 767px) 45vw, 180px"
                  className="object-cover transition duration-200 group-hover:scale-105"
                />
              </span>
              <span className="mt-1.5 block min-h-[1.35em] overflow-visible px-1 text-center text-[clamp(10px,2.85vw,12px)] leading-[1.25] font-black whitespace-nowrap text-black uppercase">
                {node.label}
              </span>
            </>
          );

          return (
            <li key={node.href}>
              {getCategoryMenuAction(node) === "submenu" ? (
                <button
                  type="button"
                  onClick={() => onEnter(node)}
                  className="group flex w-full flex-col rounded-md text-left focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                >
                  {tileContent}
                </button>
              ) : (
                <Link
                  href={node.href}
                  onClick={onNavigate}
                  className="group flex w-full flex-col rounded-md text-left focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                >
                  {tileContent}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
