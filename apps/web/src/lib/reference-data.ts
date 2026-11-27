import "server-only";
import { API_URL } from "./api-url";
import type { Category, Commune } from "./listings";

/*
 * Categories and communes for the public pages. They change rarely and hold
 * nothing personal: read without a session, again at most every hour.
 */

async function read<T>(path: string, key: string): Promise<T[]> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      next: { revalidate: 3600 },
    });
    if (!response.ok) return [];
    return ((await response.json()) as Record<string, T[]>)[key] ?? [];
  } catch {
    // The search still works without its lists.
    return [];
  }
}

export function loadCategories(): Promise<Category[]> {
  return read<Category>("/categories", "categories");
}

export function loadCommunes(): Promise<Commune[]> {
  return read<Commune>("/communes", "communes");
}
