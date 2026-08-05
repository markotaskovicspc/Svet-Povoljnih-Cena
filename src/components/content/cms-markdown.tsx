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
  variant = "page",
}: {
  markdown: string;
  template?: "STANDARD" | "FAQ";
  variant?: "page" | "compact";
}) {
  return (
    <div
      className={cn(
        "cms-markdown",
        "[&_blockquote]:mt-5 [&_blockquote]:border-l-4 [&_blockquote]:border-walnut/40 [&_blockquote]:pl-4 [&_blockquote]:italic",
        "[&_table]:mt-6 [&_table]:w-full [&_table]:border-collapse [&_th]:bg-muted-bg [&_th]:font-semibold",
        "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2",
        variant === "compact" &&
          "text-justify text-sm leading-relaxed text-ink-700 [&_a]:text-brand-blue [&_a]:underline [&_a]:underline-offset-2 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted-bg [&_pre]:p-3 [&_pre]:text-left [&_pre]:font-mono [&_pre]:text-xs [&_strong]:font-bold [&_strong]:text-ink-900 [&_table]:mt-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
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
              className={cn(
                "scroll-mt-28 font-display font-bold text-brand-blue first:pt-0",
                variant === "compact"
                  ? "pt-5 text-lg"
                  : "pt-10 text-2xl md:text-3xl",
              )}
            >
              {children}
            </h2>
          ),
          h3: ({ children, node }) => (
            <h3
              id={typeof node?.properties?.id === "string" ? node.properties.id : undefined}
              className={cn(
                "scroll-mt-28 font-display font-semibold text-ink-900",
                variant === "compact"
                  ? "pt-4 text-base"
                  : "pt-7 text-lg md:text-xl",
              )}
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
