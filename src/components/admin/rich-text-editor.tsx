"use client";

import { useRef, useState } from "react";

export function RichTextEditor({
  name,
  defaultValue,
  required = false,
}: {
  name: string;
  defaultValue: string;
  required?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(defaultValue);

  const run = (command: string, argument?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, argument);
    setValue(editorRef.current?.innerHTML ?? "");
  };

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-surface">
      <div className="flex flex-wrap gap-1 border-b border-border/60 bg-muted-bg/50 p-2">
        {[
          ["bold", "B"],
          ["italic", "I"],
          ["underline", "U"],
          ["insertUnorderedList", "• Lista"],
          ["insertOrderedList", "1. Lista"],
        ].map(([command, label]) => (
          <button
            key={command}
            type="button"
            onClick={() => run(command)}
            className="h-7 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink-700 hover:bg-muted-bg"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => run("formatBlock", "h2")}
          className="h-7 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink-700 hover:bg-muted-bg"
        >
          Naslov
        </button>
        <button
          type="button"
          onClick={() => run("formatBlock", "p")}
          className="h-7 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink-700 hover:bg-muted-bg"
        >
          Pasus
        </button>
        <button
          type="button"
          onClick={() => run("removeFormat")}
          className="h-7 rounded-md border border-border bg-surface px-2 text-xs font-medium text-ink-700 hover:bg-muted-bg"
        >
          Očisti format
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: defaultValue }}
        onInput={(event) => setValue(event.currentTarget.innerHTML)}
        className="prose prose-sm min-h-40 max-w-none px-3 py-2 text-sm text-ink-800 outline-none"
        role="textbox"
        aria-label="Formatirani opis za sajt"
        aria-multiline="true"
      />
      <input type="hidden" name={name} value={value} required={required} />
    </div>
  );
}
