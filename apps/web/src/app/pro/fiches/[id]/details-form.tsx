"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Category, OwnListing } from "@/lib/listings";

const field = "rounded-md border border-foreground/30 px-3 py-2 text-base";

/**
 * Completes one's own draft and sends it for validation (S4). Sending saves
 * first, so what is on the screen is what gets reviewed.
 */
export function DetailsForm({
  listing,
  categories,
}: {
  listing: OwnListing;
  categories: Category[];
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState<"save" | "send" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const url = `/api/v1/pro/listings/${listing.id}`;

  /** True when the API accepted; otherwise shows why. */
  async function call(path: string, init: RequestInit): Promise<boolean> {
    const response = await fetch(path, init);
    if (response.ok) return true;
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      fields?: Record<string, string>;
    };
    setMessage(body.message ?? "Une erreur est survenue. Réessayez.");
    setErrors(body.fields ?? {});
    return false;
  }

  async function run(action: "save" | "send") {
    if (!form.current) return;
    const data = new FormData(form.current);
    const text = (name: string) => String(data.get(name) ?? "");
    setPending(action);
    setErrors({});
    setMessage(null);
    setSaved(false);
    try {
      const done =
        (await call(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: text("categoryId"),
            name: text("name"),
            description: text("description"),
            phone: text("phone"),
            whatsapp: text("whatsapp"),
          }),
        })) &&
        (action === "save" ||
          (await call(`${url}/submit`, { method: "POST" })));
      if (done && action === "save") setSaved(true);
      // The status may have changed even when sending was refused.
      router.refresh();
    } catch {
      setMessage("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setPending(null);
  }

  const error = (name: string) =>
    errors[name] ? (
      <span className="text-sm text-red-700">{errors[name]}</span>
    ) : null;

  return (
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault();
        void run("save");
      }}
      onChange={() => setSaved(false)}
      className="flex flex-col gap-4"
      noValidate
    >
      <h2 className="text-lg font-semibold">Informations</h2>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Nom</span>
        <input
          name="name"
          defaultValue={listing.name}
          maxLength={120}
          className={field}
        />
        {error("name")}
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Catégorie</span>
        <select
          name="categoryId"
          defaultValue={
            categories.some((c) => c.id === listing.category.id)
              ? listing.category.id
              : ""
          }
          className={field}
        >
          <option value="">Choisissez…</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {error("categoryId")}
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Description</span>
        <textarea
          name="description"
          defaultValue={listing.description ?? ""}
          rows={4}
          maxLength={2000}
          className={field}
        />
        {error("description")}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-medium">Téléphone</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={listing.phone ?? ""}
            placeholder="90 12 34 56"
            className={field}
          />
          {error("phone")}
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="font-medium">WhatsApp</span>
          <input
            name="whatsapp"
            type="tel"
            inputMode="tel"
            defaultValue={listing.whatsapp ?? ""}
            className={field}
          />
          {error("whatsapp")}
        </label>
      </div>
      {error("location")}

      {message && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {message}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-green-900"
        >
          Modifications enregistrées.
        </p>
      )}

      <button
        type="submit"
        disabled={pending !== null}
        className="rounded-md border border-foreground/30 px-4 py-3 font-semibold disabled:opacity-60"
      >
        {pending === "save" ? "Enregistrement…" : "Enregistrer"}
      </button>
      <button
        type="button"
        onClick={() => void run("send")}
        disabled={pending !== null}
        className="rounded-md bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending === "send" ? "Envoi…" : "Envoyer pour validation"}
      </button>
      <p className="text-sm opacity-70">
        Après l&apos;envoi, la fiche et ses photos ne peuvent plus être
        modifiées jusqu&apos;à la décision.
      </p>
    </form>
  );
}
