"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { requestSmsCode } from "@/lib/sms-code";

type Field = "phone" | "code" | "password";

const inputClass = "rounded-md border border-foreground/30 px-3 py-2 text-base";

/** Step 1: the number receives a code. Step 2: code and new password. */
export function PasswordResetForm() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "reset">("phone");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [pending, setPending] = useState(false);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const result = await requestSmsCode(phone, "PASSWORD_RESET");
    setPending(false);
    if (result.ok) {
      setInfo(result.message);
      setStep("reset");
    } else {
      setMessage(result.message);
    }
  }

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setFieldErrors({});
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/v1/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, phone }),
      });
      if (response.ok) {
        router.replace("/pro");
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

  const alerts = (
    <>
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
    </>
  );

  if (step === "phone") {
    return (
      <form onSubmit={sendCode} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Numéro de téléphone</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="90 12 34 56"
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={inputClass}
          />
        </label>
        {alerts}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Patientez…" : "Recevoir un code par SMS"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (phone.trim() === "") {
              setMessage("Indiquez d'abord votre numéro de téléphone.");
              return;
            }
            setMessage(null);
            setInfo(null);
            setStep("reset");
          }}
          className="text-accent underline"
        >
          J&apos;ai déjà un code
        </button>
        <p className="text-sm opacity-70">
          Pas de SMS ? Appelez l&apos;équipe CornerGood : après avoir vérifié
          qui vous êtes, elle vous donne un code.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={reset} className="flex flex-col gap-4" noValidate>
      <p>
        Numéro : <strong>{phone}</strong>{" "}
        <button
          type="button"
          onClick={() => {
            setStep("phone");
            setInfo(null);
          }}
          className="text-accent underline"
        >
          Changer
        </button>
      </p>
      <label className="flex flex-col gap-1">
        <span className="font-medium">
          Code reçu par SMS ou donné par l&apos;équipe
        </span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6 chiffres"
          required
          aria-invalid={fieldErrors.code ? true : undefined}
          className={inputClass}
        />
        {fieldErrors.code && (
          <span className="text-sm text-red-700">{fieldErrors.code}</span>
        )}
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Nouveau mot de passe</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={fieldErrors.password ? true : undefined}
          className={inputClass}
        />
        {fieldErrors.password ? (
          <span className="text-sm text-red-700">{fieldErrors.password}</span>
        ) : (
          <span className="text-sm opacity-70">8 caractères au moins.</span>
        )}
      </label>
      {alerts}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Patientez…" : "Changer mon mot de passe"}
      </button>
    </form>
  );
}
