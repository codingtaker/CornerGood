/** Asks the API to text a one-time code. The answer never says whether the number has an account. */
export async function requestSmsCode(
  phone: string,
  purpose: "LOGIN_UNLOCK" | "PASSWORD_RESET",
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch("/api/v1/auth/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, purpose }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      fields?: { phone?: string };
    };
    return {
      ok: response.ok,
      message:
        body.fields?.phone ??
        body.message ??
        "Une erreur est survenue. Réessayez.",
    };
  } catch {
    return {
      ok: false,
      message: "Connexion impossible. Vérifiez votre réseau et réessayez.",
    };
  }
}
