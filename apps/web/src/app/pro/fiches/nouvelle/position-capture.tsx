"use client";

import { useState } from "react";
import {
  capturePosition,
  GOOD_ACCURACY_M,
  type CapturedPosition,
} from "@/lib/geolocation";
import type { Commune } from "@/lib/listings";

export interface LocatedPosition extends CapturedPosition {
  /** Commune proposed by /communes/locate, or null outside Grand Lomé. */
  proposedCommuneId: string | null;
}

interface PositionCaptureProps {
  position: LocatedPosition | null;
  onCaptured: (position: LocatedPosition) => void;
  communes: Commune[];
  buttonLabel: string;
}

/**
 * "Je suis devant mon activité": takes the phone's position, says how precise
 * it is, and asks the API which commune it falls in. The commune is only a
 * proposal: the person confirms it in the list (ADR-044).
 */
export function PositionCapture({
  position,
  onCaptured,
  communes,
  buttonLabel,
}: PositionCaptureProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function capture() {
    setPending(true);
    setError(null);
    try {
      const captured = await capturePosition();
      let proposedCommuneId: string | null = null;
      try {
        const response = await fetch(
          `/api/v1/communes/locate?lat=${captured.lat}&lng=${captured.lng}`,
        );
        if (response.ok) {
          const body = (await response.json()) as {
            commune: { id: string } | null;
          };
          proposedCommuneId = body.commune?.id ?? null;
        }
      } catch {
        // Without the network, the commune is simply chosen from the list.
      }
      onCaptured({ ...captured, proposedCommuneId });
    } catch (failure) {
      setError((failure as Error).message);
    }
    setPending(false);
  }

  const proposed = communes.find((c) => c.id === position?.proposedCommuneId);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={capture}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending
          ? "Recherche de la position…"
          : position
            ? "Relever à nouveau"
            : buttonLabel}
      </button>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      )}

      {position && (
        <div
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-green-900"
        >
          <p>Position relevée, précise à {position.accuracyM} m près.</p>
          {position.accuracyM > GOOD_ACCURACY_M && (
            <p className="mt-1 font-medium">
              C&apos;est peu précis : placez-vous dehors, devant l&apos;entrée,
              puis relevez à nouveau.
            </p>
          )}
          <p className="mt-1">
            {proposed
              ? `Commune proposée : ${proposed.name}. Vérifiez-la ci-dessous.`
              : "Cette position semble hors du Grand Lomé : choisissez la commune ci-dessous."}
          </p>
        </div>
      )}
    </div>
  );
}
