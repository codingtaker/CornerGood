import "server-only";
import { cookies } from "next/headers";
import { API_URL } from "./api-url";
import { SESSION_COOKIE } from "./session-cookie";

export type Role = "PROFESSIONAL" | "MODERATOR" | "ADMIN";

export interface SessionUser {
  id: string;
  role: Role;
  fullName: string;
}

/** Roles that may open /admin. The API checks it again on every call. */
export const ADMIN_ROLES: Role[] = ["MODERATOR", "ADMIN"];

/**
 * Calls the API on behalf of the visitor, with their session cookie.
 * Server components only: the cookie is HttpOnly, page scripts cannot read it.
 */
export async function apiFetch(path: string): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return fetch(`${API_URL}${path}`, {
    headers: token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {},
    cache: "no-store",
  });
}

/** The signed-in user, or null when there is no valid session. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const response = await apiFetch("/auth/me");
  if (!response.ok) return null;
  const body = (await response.json()) as { user: SessionUser };
  return body.user;
}
