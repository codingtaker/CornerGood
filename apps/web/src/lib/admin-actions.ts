/**
 * Sends one action of the back-office (a decision, a report handled) and
 * returns the API's message when it is refused, or null when it is done.
 */
export async function postAction(
  url: string,
  body: Record<string, string> = {},
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return null;
    const answer = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    return answer.message ?? "Une erreur est survenue. Réessayez.";
  } catch {
    return "Connexion impossible. Vérifiez votre réseau et réessayez.";
  }
}
