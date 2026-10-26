"use client";

import { useEffect, useRef, useState } from "react";
import { permissionGroups } from "@/lib/admin/access-policy";

function GroupCheckbox({ checked, partial, label, onChange }: {
  checked: boolean; partial: boolean; label: string; onChange: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = partial; }, [partial]);
  return <label className="flex items-center gap-2 font-medium">
    <input ref={input} type="checkbox" checked={checked} aria-checked={partial ? "mixed" : checked}
      onChange={onChange} className="size-4" />
    {label}
  </label>;
}

export function StaffPermissionSelector({ initialModules = [] }: { initialModules?: readonly string[] }) {
  const [selected, setSelected] = useState(() => new Set(initialModules));
  return <fieldset className="space-y-3">
    <legend className="text-sm font-medium">Pristup celinama i modulima</legend>
    <p className="text-sm text-ink-500">Možete odabrati više celina ili samo pojedinačne module. Izbor celine uključuje sve njene module.</p>
    <div className="grid gap-3 lg:grid-cols-2">
      {permissionGroups.map(group => {
        const all = group.modules.every(module => selected.has(module.key));
        const some = group.modules.some(module => selected.has(module.key));
        return <section key={group.id} className="rounded-lg border border-border p-3">
          <GroupCheckbox checked={all} partial={some && !all} label={group.label} onChange={() => {
            setSelected(current => {
              const next = new Set(current);
              for (const permission of group.modules) {
                if (all) next.delete(permission.key); else next.add(permission.key);
              }
              return next;
            });
          }} />
          <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
            {group.modules.map(module => <label key={module.key} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="modules" value={module.key} checked={selected.has(module.key)}
                onChange={() => setSelected(current => {
                  const next = new Set(current);
                  if (next.has(module.key)) next.delete(module.key); else next.add(module.key);
                  return next;
                })} className="mt-0.5 size-4 shrink-0" />
              <span>{module.label}</span>
            </label>)}
          </div>
        </section>;
      })}
    </div>
    <p className="text-xs text-ink-500" aria-live="polite">Izabrano modula: {selected.size}</p>
  </fieldset>;
}
