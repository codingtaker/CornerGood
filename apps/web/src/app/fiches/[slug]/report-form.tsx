"use client";

import { useState, type FormEvent } from "react";
import {
  MAX_CONTACT_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  REASON_LABELS,
  REPORT_REASONS,
} from "@/lib/reports";

const field = "rounded-md border border-foreground/30 px-3 py-2 text-base";

/**
 * "Signaler une erreur", with or without an account (ADR-017). The contact is
 * optional and read by the CornerGood team only.
 */
export function ReportForm({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage(null);
    setErrors({});
    try {
      const response = await fetch(
        `/api/v1/listings/${encodeURIComponent(slug)}/reports`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: data.get("reason") ?? "",
            description: data.get("description") ?? "",
            reporterContact: data.get("reporterContact") ?? "",
          }),
        },
      );
      if (response.ok) {
        setSent(true);
      } else {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          fields?: Record<string, string>;
        };
        setMessage(body.message ?? "Une erreur est survenue. Réessayez.");
        setErrors(body.fields ?? {});
      }
    } catch {
      setMessage("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setPending(false);
  }

  if (sent) {
    return (
      <p
        role="status"
        className="rounded-md bg-green-50 px-3 py-2 text-green-900"
      >
        Merci. L&apos;équipe CornerGood va vérifier cette fiche.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm underline opacity-80"
      >
        Signaler une erreur sur cette fiche
      </button>
    );
  }

  const error = (name: string) =>
    errors[name] ? (
      <span className="text-sm text-red-700">{errors[name]}</span>
    ) : null;

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md border border-foreground/20 p-4"
      noValidate
    >
      <h2 className="text-lg font-semibold">Signaler une erreur</h2>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Qu&apos;est-ce qui ne va pas ?</legend>
        {REPORT_REASONS.map((reason) => (
          <label key={reason} className="flex items-center gap-2">
            <input type="radio" name="reason" value={reason} />
            {REASON_LABELS[reason]}
          </label>
        ))}
        {error("reason")}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Expliquez en quelques mots</span>
        <textarea
          name="description"
          rows={3}
          maxLength={MAX_DESCRIPTION_LENGTH}
          className={field}
        />
        {error("description")}
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">
          Votre téléphone ou e-mail (facultatif)
        </span>
        <input
          name="reporterContact"
          maxLength={MAX_CONTACT_LENGTH}
          autoComplete="off"
          className={field}
        />
        <span className="text-sm opacity-70">
          Seulement si vous acceptez que l&apos;équipe vous recontacte. Il
          n&apos;est jamais affiché.
        </span>
        {error("reporterContact")}
      </label>
      {message && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Envoi…" : "Envoyer le signalement"}
      </button>
    </form>
  );
}
