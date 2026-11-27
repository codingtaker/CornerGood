"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_NOTE_LENGTH } from "@/lib/reports";
import { postAction } from "@/lib/admin-actions";

/**
 * "Prendre en charge", then "Résolu" or "Classé" with a note. Closing a
 * report never changes the listing: correct or suspend it on its own page.
 */
export function ReportActions({
  reportId,
  status,
}: {
  reportId: string;
  status: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/v1/admin/reports/${reportId}`;

  async function act(action: "take" | "resolve" | "dismiss") {
    if (action !== "take" && note.trim() === "") {
      setError("Notez ce qui a été constaté ou fait avant de clore.");
      return;
    }
    setPending(action);
    setError(null);
    const refused = await postAction(
      `${url}/${action}`,
      action === "take" ? {} : { note },
    );
    setPending(null);
    if (refused) setError(refused);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-foreground/20 p-4">
      <h2 className="text-lg font-semibold">Traitement</h2>
      {status === "OPEN" && (
        <button
          type="button"
          onClick={() => void act("take")}
          disabled={pending !== null}
          className="rounded-md border border-foreground/30 px-4 py-3 font-semibold disabled:opacity-60"
        >
          {pending === "take" ? "Patientez…" : "Prendre en charge"}
        </button>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-medium">Note de traitement</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="Ce qui a été vérifié, ce qui a été fait."
          className="rounded-md border border-foreground/30 px-3 py-2 text-base"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void act("resolve")}
          disabled={pending !== null}
          className="rounded-md bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {pending === "resolve" ? "Patientez…" : "Résolu"}
        </button>
        <button
          type="button"
          onClick={() => void act("dismiss")}
          disabled={pending !== null}
          className="rounded-md border border-foreground/30 px-4 py-3 font-semibold disabled:opacity-60"
        >
          {pending === "dismiss" ? "Patientez…" : "Classé"}
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
