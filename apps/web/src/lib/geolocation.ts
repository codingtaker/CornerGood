/** A position taken by the phone, as the API expects it. */
export interface CapturedPosition {
  lat: number;
  lng: number;
  /** Radius of uncertainty in metres, as the device reports it. */
  accuracyM: number;
  capturedAt: string;
}

/** Above this, the form suggests trying again outside, away from walls. */
export const GOOD_ACCURACY_M = 50;

/** Plain French for the reasons the browser gives. */
export function geolocationMessage(code: number): string {
  switch (code) {
    case 1:
      return "L'accès à la position est refusé. Autorisez-le dans les réglages du navigateur, puis réessayez.";
    case 3:
      return "La position n'a pas été trouvée à temps. Placez-vous dehors, à découvert, puis réessayez.";
    default:
      return "La position n'est pas disponible. Vérifiez que la localisation du téléphone est activée.";
  }
}

/**
 * Asks the device for a fresh, precise position (GPS rather than network).
 * Rejects with a message to show as is.
 */
export function capturePosition(
  geolocation: Geolocation | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.geolocation,
): Promise<CapturedPosition> {
  return new Promise((resolve, reject) => {
    if (!geolocation) {
      reject(
        new Error(
          "Ce navigateur ne donne pas la position. Choisissez la commune dans la liste.",
        ),
      );
      return;
    }
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: Math.round(position.coords.accuracy),
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      (error) => reject(new Error(geolocationMessage(error.code))),
      // A cached position could be from somewhere else: always a new one.
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}
