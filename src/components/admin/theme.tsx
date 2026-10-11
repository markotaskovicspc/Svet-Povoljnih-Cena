"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export const ADMIN_THEME_COOKIE = "spc-admin-theme";
type AdminTheme = "light" | "dark";

const AdminThemeContext = createContext<{
  theme: AdminTheme;
  toggle: () => void;
} | null>(null);

export function AdminThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: AdminTheme;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const pathname = usePathname();
  // Documents and storefront previews should look like their printed/public version.
  const isPreview = /\/(stampa|adresnice|pregled)(\/|$)/.test(pathname);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.cookie = `${ADMIN_THEME_COOKIE}=${next}; Path=/admin; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }

  return (
    <AdminThemeContext.Provider value={{ theme, toggle }}>
      <div data-admin-theme={isPreview ? "light" : theme}>
        {children}
      </div>
    </AdminThemeContext.Provider>
  );
}

export function AdminThemeToggle() {
  const context = useContext(AdminThemeContext);
  if (!context) return null;
  const dark = context.theme === "dark";
  const label = dark ? "Uključi svetli režim" : "Uključi tamni režim";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={context.toggle}
      aria-label={label}
      aria-pressed={dark}
      title={label}
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
      <span className="hidden lg:inline">{dark ? "Svetli režim" : "Tamni režim"}</span>
    </Button>
  );
}
