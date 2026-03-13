export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    "/api/sc/:path*",
    "/api/auth/soundcloud/:path*",
    "/api/auth/me",
    "/dashboard/:path*",
    "/link-soundcloud",
  ],
};
