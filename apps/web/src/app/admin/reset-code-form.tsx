"use client";

import { useState, type FormEvent } from "react";
import { formatDate } from "@/lib/listings";

interface Issued {
  code: string;
  expiresAt: string;
  fullName: string;
}

const inputClass = "rounded-md border border-foreground/30 px-3 py-2 text-base";

/**
 * A password reset code for a professional who cannot receive the SMS
 * (ADR-037). The administrator checks who is calling first, then reads the
 * code to them; it is shown once.
 */
export function ResetCodeForm() {
  const [phone, setPhone] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setIssued(null);
    try {
      const response = await fetch("/api/v1/admin/password-reset-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<
        Issued & { message: string; fields: { phone?: string } }
      >;
      if (response.ok && body.code && body.expiresAt && body.fullName) {
        setIssued({
          code: body.code,
          expiresAt: body.expiresAt,
          fullName: body.fullName,
        });
      } else {
        setMessage(
          body.fields?.phone ??
            body.message ??
            "Une erreur est survenue. Réessayez.",
        );
      }
    } catch {
      setMessage("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setPending(false);
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-foreground/20 p-4">
      <h2 className="text-lg font-semibold">Mot de passe oublié sans SMS</h2>
      <p className="text-sm opacity-80">
        Vérifiez d&apos;abord qui vous appelle (nom, activité, fiche). Le code
        remplace tout code précédent et vaut une heure.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Numéro du professionnel</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="90 12 34 56"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-foreground/30 px-4 py-3 font-semibold disabled:opacity-60"
        >
          {pending ? "Patientez…" : "Créer un code"}
        </button>
      </form>
      {message && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {message}
        </p>
      )}
      {issued && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md bg-green-50 px-3 py-2 text-green-900"
        >
          <p>Code pour {issued.fullName} :</p>
          <p className="font-mono text-3xl font-bold tracking-widest">
            {issued.code}
          </p>
          <p className="text-sm">
            Valable jusqu&apos;au {formatDate(issued.expiresAt)}. Lisez-le à la
            personne : il ne sera plus affiché. Elle le saisit sur « Mot de
            passe oublié ».
          </p>
        </div>
      )}
    </section>
  );
}
