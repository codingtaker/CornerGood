"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/connexion");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="rounded-md border border-foreground/30 px-4 py-2 font-medium disabled:opacity-60"
    >
      Se déconnecter
    </button>
  );
}
