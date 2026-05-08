import Link from "next/link";

type Crumb = { href?: string; label: string };

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
}: {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-b border-border/60 bg-surface/80 backdrop-blur">
      <div className="flex flex-col gap-2 px-8 py-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          {crumbs && crumbs.length > 0 ? (
            <nav className="text-xs text-ink-500">
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`}>
                  {c.href ? (
                    <Link href={c.href} className="hover:text-walnut">
                      {c.label}
                    </Link>
                  ) : (
                    <span>{c.label}</span>
                  )}
                  {i < crumbs.length - 1 ? (
                    <span className="px-1.5 text-ink-300">/</span>
                  ) : null}
                </span>
              ))}
            </nav>
          ) : null}
          <h1 className="font-display text-2xl tracking-tight text-ink-900">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm text-ink-500">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
