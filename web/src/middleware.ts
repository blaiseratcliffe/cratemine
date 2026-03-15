export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    "/api/sc/:path*",
    "/api/auth/soundcloud/:path*",
    "/api/auth/me",
    "/api/admin/:path*",
    "/api/saved-searches/:path*",
    "/api/usage",
    "/dashboard/:path*",
    "/link-soundcloud",
  ],
};
