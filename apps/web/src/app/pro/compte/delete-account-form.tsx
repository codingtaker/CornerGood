"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Asks for the password, then a clear confirmation, before deleting. */
export function DeleteAccountForm() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("confirm") !== "on") {
      setMessage("Cochez la case pour confirmer la suppression.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/auth/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: data.get("password") }),
      });
      if (response.ok) {
        router.replace("/compte-supprime");
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      setMessage(body.message ?? "Une erreur est survenue. Réessayez.");
    } catch {
      setMessage("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Votre mot de passe</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-md border border-foreground/30 px-3 py-2 text-base"
        />
      </label>
      <label className="flex items-start gap-2">
        <input name="confirm" type="checkbox" className="mt-1" />
        <span>Je comprends que la suppression de mon compte est définitive.</span>
      </label>
      {message && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-700 px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Patientez…" : "Supprimer définitivement mon compte"}
      </button>
    </form>
  );
}
