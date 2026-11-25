"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { capturePosition, GOOD_ACCURACY_M } from "@/lib/geolocation";
import type { Commune } from "@/lib/listings";
import type { MapPoint } from "./pin-map";

const PinMap = dynamic(() => import("./pin-map").then((m) => m.PinMap), {
  ssr: false,
});

export interface LocatedPosition {
  lat: number;
  lng: number;
  /** MANUAL_PIN as soon as the pin is placed or moved by hand (ADR-041). */
  source: "DEVICE_GPS" | "MANUAL_PIN";
  /** Of the GPS reading only: a pin placed by hand has none. */
  accuracyM: number | null;
  capturedAt: string | null;
  /** Commune proposed by /communes/locate; null when none was found. */
  proposedCommuneId: string | null;
  /** "Oui, c'est ici": the pin was checked on the map. */
  confirmed: boolean;
}

interface PositionCaptureProps {
  position: LocatedPosition | null;
  onChange: (position: LocatedPosition) => void;
  communes: Commune[];
  buttonLabel: string;
  /** False for a home: its area is not sent to the tile server. */
  withMap: boolean;
}

type Located = "found" | "outside" | "unknown";

async function locate(point: MapPoint): Promise<{
  communeId: string | null;
  result: Located;
}> {
  try {
    const response = await fetch(
      `/api/v1/communes/locate?lat=${point.lat}&lng=${point.lng}`,
    );
    if (response.ok) {
      const body = (await response.json()) as {
        commune: { id: string } | null;
      };
      return body.commune
        ? { communeId: body.commune.id, result: "found" }
        : { communeId: null, result: "outside" };
    }
  } catch {
    // Without the network, the commune is simply chosen from the list.
  }
  return { communeId: null, result: "unknown" };
}

/**
 * Where the activity is: the phone's position ("Je suis devant mon activité")
 * or a pin placed by hand, checked on a map (ADR-041). The API then says
 * which commune it falls in; that is only a proposal (ADR-044).
 */
export function PositionCapture({
  position,
  onChange,
  communes,
  buttonLabel,
  withMap,
}: PositionCaptureProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [located, setLocated] = useState<Located>("unknown");
  // Only the last request may answer: the pin can move while one is running.
  const request = useRef(0);

  async function capture() {
    const current = ++request.current;
    setPending(true);
    setError(null);
    try {
      const captured = await capturePosition();
      const { communeId, result } = await locate(captured);
      if (current === request.current) {
        setLocated(result);
        setMapOpen(withMap);
        onChange({
          ...captured,
          source: "DEVICE_GPS",
          proposedCommuneId: communeId,
          confirmed: !withMap,
        });
      }
    } catch (failure) {
      if (current === request.current) setError((failure as Error).message);
    }
    setPending(false);
  }

  async function movedByHand(point: MapPoint) {
    const current = ++request.current;
    const placed: LocatedPosition = {
      ...point,
      source: "MANUAL_PIN",
      accuracyM: null,
      capturedAt: null,
      proposedCommuneId: null,
      confirmed: false,
    };
    setError(null);
    setLocated("unknown");
    // At once, so the pin does not jump back while the commune is searched.
    onChange(placed);
    const { communeId, result } = await locate(point);
    if (current !== request.current) return;
    setLocated(result);
    onChange({ ...placed, proposedCommuneId: communeId });
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
          : position?.source === "DEVICE_GPS"
            ? "Relever à nouveau"
            : buttonLabel}
      </button>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      )}

      {withMap && !mapOpen && (
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="rounded-md border border-foreground/30 px-4 py-3 font-semibold"
        >
          Placer moi-même sur la carte
        </button>
      )}

      {withMap && mapOpen && (
        <>
          <p className="text-sm opacity-80">
            {position
              ? "Vérifiez l'épingle. Si elle n'est pas au bon endroit, faites-la glisser ou touchez le bon endroit."
              : "Agrandissez la carte, puis touchez l'endroit exact de votre activité."}
          </p>
          <PinMap
            point={position}
            accuracyM={position?.accuracyM ?? null}
            onMoved={movedByHand}
          />
        </>
      )}

      {position && (
        <div
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-green-900"
        >
          <p>
            {position.accuracyM !== null
              ? `Position relevée, précise à ${position.accuracyM} m près.`
              : "Épingle placée à la main."}
          </p>
          {position.accuracyM !== null &&
            position.accuracyM > GOOD_ACCURACY_M && (
              <p className="mt-1 font-medium">
                C&apos;est peu précis : placez-vous dehors, devant
                l&apos;entrée, puis relevez à nouveau
                {withMap && ", ou déplacez l'épingle"}.
              </p>
            )}
          <p className="mt-1">
            {proposed
              ? `Commune proposée : ${proposed.name}. Vérifiez-la ci-dessous.`
              : located === "outside"
                ? "Cette position semble hors du Grand Lomé : choisissez la commune ci-dessous."
                : "Choisissez la commune ci-dessous."}
          </p>
        </div>
      )}

      {withMap &&
        position &&
        (position.confirmed ? (
          <p className="font-medium text-green-900">Emplacement confirmé.</p>
        ) : (
          <button
            type="button"
            onClick={() => onChange({ ...position, confirmed: true })}
            className="rounded-md border-2 border-accent px-4 py-3 font-semibold text-accent"
          >
            Oui, c&apos;est ici
          </button>
        ))}
    </div>
  );
}
