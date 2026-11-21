"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { requestSmsCode } from "@/lib/sms-code";

type Field = "fullName" | "phone" | "email" | "password" | "code";

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
  code: "Code reçu par SMS",
};

/**
 * Sign-up and sign-in form; both post to the API through /api/v1. When a
 * number is blocked after too many failures, the sign-in form offers a code
 * by SMS: with it, the owner of the number gets in without waiting.
 */
export function AccountForm({ mode, next }: AccountFormProps) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [pending, setPending] = useState(false);
  /** "offer": blocked, a code may be sent; "code": a code was sent. */
  const [unlock, setUnlock] = useState<"none" | "offer" | "code">("none");

  const fields: Field[] =
    mode === "register"
      ? ["fullName", "phone", "email", "password"]
      : unlock === "code"
        ? ["phone", "password", "code"]
        : ["phone", "password"];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setInfo(null);
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
        unlockBySms?: boolean;
      };
      setMessage(body.message ?? "Une erreur est survenue. Réessayez.");
      if (body.fields) setFieldErrors(body.fields);
      else if (body.field && body.message)
        setFieldErrors({ [body.field]: body.message });
      if (body.unlockBySms && unlock === "none") setUnlock("offer");
    } catch {
      setMessage("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setPending(false);
  }

  async function sendUnlockCode() {
    const phone = String(
      new FormData(form.current ?? undefined).get("phone") ?? "",
    );
    setPending(true);
    const result = await requestSmsCode(phone, "LOGIN_UNLOCK");
    setPending(false);
    if (result.ok) {
      setMessage(null);
      setInfo(result.message);
      setUnlock("code");
    } else {
      setMessage(result.message);
    }
  }

  return (
    <form
      ref={form}
      onSubmit={submit}
      className="flex flex-col gap-4"
      noValidate
    >
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
            inputMode={
              field === "phone"
                ? "tel"
                : field === "code"
                  ? "numeric"
                  : undefined
            }
            placeholder={
              field === "phone"
                ? "90 12 34 56"
                : field === "code"
                  ? "6 chiffres"
                  : undefined
            }
            autoComplete={
              field === "password"
                ? mode === "register"
                  ? "new-password"
                  : "current-password"
                : field === "fullName"
                  ? "name"
                  : field === "phone"
                    ? "tel"
                    : field === "code"
                      ? "one-time-code"
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
      {info && (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-green-900"
        >
          {info}
        </p>
      )}

      {unlock === "offer" && (
        <button
          type="button"
          onClick={sendUnlockCode}
          disabled={pending}
          className="rounded-md border border-accent px-4 py-3 font-semibold text-accent disabled:opacity-60"
        >
          Recevoir un code par SMS pour me connecter
        </button>
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

      {mode === "login" && (
        <Link href="/mot-de-passe-oublie" className="text-accent underline">
          Mot de passe oublié ?
        </Link>
      )}
    </form>
  );
}
