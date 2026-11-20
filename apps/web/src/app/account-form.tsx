"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Field = "fullName" | "phone" | "email" | "password";

interface AccountFormProps {
  mode: "register" | "login";
  /** Page to open once signed in (already checked by safeNextPath). */
  next: string;
}

const LABELS: Record<Field, string> = {
  fullName: "Nom complet",
  phone: "Numéro de téléphone",
  email: "E-mail (facultatif)",
  password: "Mot de passe",
};

/** Sign-up and sign-in form; both post to the API through /api/v1. */
export function AccountForm({ mode, next }: AccountFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [pending, setPending] = useState(false);

  const fields: Field[] =
    mode === "register"
      ? ["fullName", "phone", "email", "password"]
      : ["phone", "password"];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setFieldErrors({});

    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(`/api/v1/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (response.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        field?: Field;
        fields?: Partial<Record<Field, string>>;
      };
      setMessage(body.message ?? "Une erreur est survenue. Réessayez.");
      if (body.fields) setFieldErrors(body.fields);
      else if (body.field && body.message)
        setFieldErrors({ [body.field]: body.message });
    } catch {
      setMessage("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {fields.map((field) => (
        <label key={field} className="flex flex-col gap-1">
          <span className="font-medium">{LABELS[field]}</span>
          <input
            name={field}
            type={
              field === "password"
                ? "password"
                : field === "phone"
                  ? "tel"
                  : field === "email"
                    ? "email"
                    : "text"
            }
            inputMode={field === "phone" ? "tel" : undefined}
            placeholder={field === "phone" ? "90 12 34 56" : undefined}
            autoComplete={
              field === "password"
                ? mode === "register"
                  ? "new-password"
                  : "current-password"
                : field === "fullName"
                  ? "name"
                  : field === "phone"
                    ? "tel"
                    : "email"
            }
            required={field !== "email"}
            aria-invalid={fieldErrors[field] ? true : undefined}
            className="rounded-md border border-foreground/30 px-3 py-2 text-base"
          />
          {fieldErrors[field] && (
            <span className="text-sm text-red-700">{fieldErrors[field]}</span>
          )}
          {field === "password" && mode === "register" && (
            <span className="text-sm opacity-70">8 caractères au moins.</span>
          )}
        </label>
      ))}

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
        {pending
          ? "Patientez…"
          : mode === "register"
            ? "Créer mon compte"
            : "Se connecter"}
      </button>
    </form>
  );
}
