export function PdpDescription({
  description,
}: {
  description: string;
}) {
  const clean = description.trim();

  return (
    <p className="mt-2 line-clamp-3 text-justify text-sm leading-relaxed text-ink-700">
      {clean}
    </p>
  );
}
