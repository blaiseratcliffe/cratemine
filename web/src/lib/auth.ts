import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  trustHost: true,
  pages: {
    signIn: "/",
  },
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id;
      // Fetch role from DB (Prisma adapter doesn't include custom fields by default)
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true, plan: true },
      });
      session.user.role = dbUser?.role ?? "user";
      (session.user as { plan?: string }).plan = dbUser?.plan ?? "free";
      return session;
    },
  },
});
