import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  expandCmsVariables,
  isAllowedCmsHref,
  remarkCmsHeadingIds,
} from "@/lib/cms/markdown";
import { cn } from "@/lib/utils";

export function CmsMarkdown({
  markdown,
  template = "STANDARD",
}: {
  markdown: string;
  template?: "STANDARD" | "FAQ";
}) {
  return (
    <div
      className={cn(
        "cms-markdown",
        "[&_blockquote]:mt-5 [&_blockquote]:border-l-4 [&_blockquote]:border-walnut/40 [&_blockquote]:pl-4 [&_blockquote]:italic",
        "[&_table]:mt-6 [&_table]:w-full [&_table]:border-collapse [&_th]:bg-muted-bg [&_th]:font-semibold",
        "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2",
        template === "FAQ" &&
          "[&_h3]:mt-0 [&_h3]:border-t [&_h3]:border-border/60 [&_h3]:pt-5 [&_h3+p]:mb-5",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCmsHeadingIds]}
        skipHtml
        components={{
          h1: ({ children }) => <h2>{children}</h2>,
          h2: ({ children, node }) => (
            <h2
              id={typeof node?.properties?.id === "string" ? node.properties.id : undefined}
              className="scroll-mt-28 pt-10 font-display text-2xl font-bold text-brand-blue first:pt-0 md:text-3xl"
            >
              {children}
            </h2>
          ),
          h3: ({ children, node }) => (
            <h3
              id={typeof node?.properties?.id === "string" ? node.properties.id : undefined}
              className="scroll-mt-28 pt-7 font-display text-lg font-semibold text-ink-900 md:text-xl"
            >
              {children}
            </h3>
          ),
          a: ({ href, children }) => {
            if (!isAllowedCmsHref(href)) return <span>{children}</span>;
            const safeHref = expandCmsVariables(href!);
            const external = safeHref.startsWith("https://");
            return (
              <Link
                href={safeHref}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer noopener" : undefined}
              >
                {children}
              </Link>
            );
          },
          img: () => null,
        }}
      >
        {expandCmsVariables(markdown)}
      </ReactMarkdown>
    </div>
  );
}
