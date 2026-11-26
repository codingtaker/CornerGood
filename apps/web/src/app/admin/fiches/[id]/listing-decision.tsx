"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_REASON_LENGTH } from "@/lib/listings";

/** Sends one decision; returns the API's message when it is refused. */
export async function sendDecision(
  url: string,
  reason?: string,
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason === undefined ? {} : { reason }),
    });
    if (response.ok) return null;
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    return body.message ?? "Une erreur est survenue. Réessayez.";
  } catch {
    return "Connexion impossible. Vérifiez votre réseau et réessayez.";
  }
}

/**
 * "Publier" or "Rejeter avec motif" for a listing under review. Only the
 * administrator decides (ADR-010); the API checks it again.
 */
export function ListingDecision({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/v1/admin/listings/${listingId}`;

  async function decide(action: "approve" | "reject") {
    if (action === "reject" && reason.trim() === "") {
      setError("Écrivez le motif du refus : le professionnel le lira.");
      return;
    }
    if (
      action === "approve" &&
      !window.confirm("Publier cette fiche ? Elle sera visible de tous.")
    ) {
      return;
    }
    setPending(action);
    setError(null);
    const refused = await sendDecision(
      `${url}/${action}`,
      action === "reject" ? reason : undefined,
    );
    setPending(null);
    if (refused) setError(refused);
    // Even refused: someone else may have decided in the meantime.
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-foreground/20 p-4">
      <h2 className="text-lg font-semibold">Décision</h2>
      <button
        type="button"
        onClick={() => void decide("approve")}
        disabled={pending !== null}
        className="rounded-md bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending === "approve" ? "Publication…" : "Publier"}
      </button>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Motif du refus</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={MAX_REASON_LENGTH}
          placeholder="Ce qu'il faut corriger, en mots simples."
          className="rounded-md border border-foreground/30 px-3 py-2 text-base"
        />
      </label>
      <button
        type="button"
        onClick={() => void decide("reject")}
        disabled={pending !== null}
        className="rounded-md border border-red-700 px-4 py-3 font-semibold text-red-700 disabled:opacity-60"
      >
        {pending === "reject" ? "Refus…" : "Rejeter avec motif"}
      </button>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
