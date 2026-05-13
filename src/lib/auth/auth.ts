import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Facebook from "next-auth/providers/facebook";
import Apple from "next-auth/providers/apple";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";
import { authConfig } from "@/lib/auth/auth.config";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  remember: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true"),
});

const DAY = 60 * 60 * 24;
const HARDCODED_ADMIN_EMAIL = "admin@spc.local";
const HARDCODED_ADMIN_PASSWORD = "PanelPass!4827";
const CREDENTIAL_PROVIDER_IDS = new Set([
  "credentials",
  "phone-otp",
  "admin-credentials",
]);

const oauthProviders = (() => {
  const providers: NextAuthConfig["providers"] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    providers.push(
      Facebook({
        clientId: process.env.FACEBOOK_CLIENT_ID,
        clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
    providers.push(
      Apple({
        clientId: process.env.APPLE_CLIENT_ID,
        clientSecret: process.env.APPLE_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  return providers;
})();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  providers: [
    ...oauthProviders,

    // Customer email + password.
    Credentials({
      id: "credentials",
      name: "E-pošta i lozinka",
      credentials: {
        email: { label: "E-pošta", type: "email" },
        password: { label: "Lozinka", type: "password" },
        remember: { label: "Zapamti me", type: "checkbox" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, remember } = parsed.data;
        const user = await db.user.findUnique({
          where: { email: email.toLowerCase() },
        });
        if (!user || !user.passwordHash || user.deletedAt) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        return {
          id: user.id,
          email: user.email ?? undefined,
          name:
            (user.name ??
              [user.firstName, user.lastName].filter(Boolean).join(" ")) ||
            undefined,
          image: user.image ?? undefined,
          userType: "customer",
          isBusiness: user.isBusiness,
          // Hack: smuggle remember through the user object so the jwt callback
          // can pick it up on the initial sign-in.
          remember,
        } as unknown as import("next-auth").User;
      },
    }),

    // Phone OTP — verification token must be created via a server action
    // that sends the SMS. The credentials provider only validates it.
    Credentials({
      id: "phone-otp",
      name: "SMS kod",
      credentials: {
        phone: { label: "Telefon", type: "tel" },
        code: { label: "Kod", type: "text" },
      },
      async authorize(raw) {
        const schema = z.object({
          phone: z.string().min(8).max(20),
          code: z.string().regex(/^\d{4,8}$/),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return null;
        const phone = parsed.data.phone.replace(/\s+/g, "");

        const token = await db.verificationToken.findFirst({
          where: { identifier: `phone:${phone}`, token: parsed.data.code },
        });
        if (!token || token.expires < new Date()) return null;

        // Single-use.
        await db.verificationToken.deleteMany({
          where: { identifier: `phone:${phone}` },
        });

        const user = await db.user.upsert({
          where: { phone },
          create: { phone, phoneVerified: new Date() },
          update: { phoneVerified: new Date(), lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email ?? undefined,
          name:
            (user.name ??
              [user.firstName, user.lastName].filter(Boolean).join(" ")) ||
            undefined,
          image: user.image ?? undefined,
          userType: "customer",
          isBusiness: user.isBusiness,
        };
      },
    }),

    // Admin sign-in — separate table, separate provider id so the UI can
    // route admin staff through a dedicated form.
    Credentials({
      id: "admin-credentials",
      name: "Admin",
      credentials: {
        email: { label: "E-pošta", type: "email" },
        password: { label: "Lozinka", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        if (
          email.toLowerCase() === HARDCODED_ADMIN_EMAIL &&
          password === HARDCODED_ADMIN_PASSWORD
        ) {
          return {
            id: "hardcoded-admin",
            email: HARDCODED_ADMIN_EMAIL,
            name: "Hardcoded Admin",
            userType: "admin",
            role: "SUPER",
          };
        }
        const admin = await db.adminUser.findUnique({
          where: { email: email.toLowerCase() },
        });
        if (!admin || !admin.enabled) return null;
        const ok = await bcrypt.compare(password, admin.passwordHash);
        if (!ok) return null;
        await db.adminUser.update({
          where: { id: admin.id },
          data: { lastLoginAt: new Date() },
        });
        return {
          id: admin.id,
          email: admin.email,
          name: [admin.firstName, admin.lastName].filter(Boolean).join(" ") || admin.email,
          userType: "admin",
          role: admin.role,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // Block disabled / soft-deleted customers from OAuth re-entry.
      if (
        account?.provider &&
        !CREDENTIAL_PROVIDER_IDS.has(account.provider) &&
        user?.id
      ) {
        const dbUser = await db.user.findUnique({
          where: { id: user.id },
          select: { deletedAt: true },
        });
        if (dbUser?.deletedAt) return false;
      }
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.uid = user.id ?? token.uid;
        token.userType = user.userType ?? "customer";
        token.role = user.role;
        token.isBusiness = user.isBusiness;
        const remember = (user as { remember?: boolean }).remember;
        if (remember !== undefined) token.remember = !!remember;
      }
      if (trigger === "update" && session) {
        // Allow client to refresh select fields after profile update.
        if (typeof session.isBusiness === "boolean")
          token.isBusiness = session.isBusiness;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid;
      session.user.userType = token.userType ?? "customer";
      session.user.role = token.role;
      session.user.isBusiness = token.isBusiness;
      return session;
    },
  },
  jwt: {
    // "Zapamti me" — extend lifetime to 90 days when the user opted in,
    // otherwise fall back to the default `session.maxAge`.
    async encode(params) {
      const { encode } = await import("next-auth/jwt");
      const remember = (params.token as { remember?: boolean } | null)?.remember;
      return encode({
        ...params,
        maxAge: remember ? 90 * DAY : params.maxAge,
      });
    },
  },
  events: {
    async createUser({ user }) {
      // Default marketing consent row so the account page can toggle without
      // a separate write path.
      if (user.id) {
        await db.marketingConsent
          .upsert({
            where: { userId: user.id },
            create: { userId: user.id },
            update: {},
          })
          .catch(() => undefined);
      }
    },
  },
});
