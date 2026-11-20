import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/session-cookie";

/*
 * Optimistic check only: a visitor without a session cookie is sent to the
 * sign-in page before the page renders. Whether the session is valid and the
 * role allowed is decided by the pages (they ask the API) and by the API itself.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const signIn = new URL("/connexion", request.url);
  signIn.searchParams.set(
    "suivant",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/pro/:path*", "/admin/:path*"],
};
