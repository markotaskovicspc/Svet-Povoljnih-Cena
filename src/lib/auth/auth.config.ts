import type { NextAuthConfig } from "next-auth";
import type { AdminRoleName } from "@prisma/client";

/**
 * Edge-safe Auth.js configuration.
 *
 * The middleware bundle runs on the Edge runtime where Prisma, bcrypt and
 * other Node APIs are unavailable. We therefore split the config:
 *
 * - `auth.config.ts` (this file) — providers stub + callbacks that only
 *   manipulate the JWT in memory. Imported by `middleware.ts`.
 * - `auth.ts` — extends this config with the Prisma adapter, Credentials
 *   providers and Node-only logic. Imported by route handlers / server
 *   components.
 *
 * Keep this file free of Node-only imports.
 */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      userType: "customer" | "admin";
      role?: AdminRoleName;
      isBusiness?: boolean;
    };
  }

  interface User {
    userType?: "customer" | "admin";
    role?: AdminRoleName;
    isBusiness?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    userType?: "customer" | "admin";
    role?: AdminRoleName;
    isBusiness?: boolean;
    remember?: boolean;
  }
}

const authSecret =
  process.env.AUTH_SECRET ??
  process.env.NEXTAUTH_SECRET ??
  (process.env.NODE_ENV === "development"
    ? "development-only-auth-secret"
    : undefined);

export const authConfig = {
  secret: authSecret,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: {
    signIn: "/nalog/prijava",
    error: "/nalog/prijava",
  },
  providers: [],
  callbacks: {
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid;
      session.user.userType = token.userType ?? "customer";
      session.user.role = token.role;
      session.user.isBusiness = token.isBusiness;
      return session;
    },
  },
} satisfies NextAuthConfig;
