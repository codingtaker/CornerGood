/*
 * Calling, writing on WhatsApp and finding the way are plain links (contract
 * §4.2): the phone does the rest, no route is needed.
 */

/** "+22890123456" → "90 12 34 56"; other numbers stay as they are. */
export function displayPhone(e164: string): string {
  const local = /^\+228(\d{8})$/.exec(e164)?.[1];
  return local ? local.replace(/(\d{2})(?=\d)/g, "$1 ") : e164;
}

export function callLink(e164: string): string {
  return `tel:${e164}`;
}

/** wa.me wants the international number without "+". */
export function whatsappLink(e164: string, listingName: string): string {
  const text = encodeURIComponent(
    `Bonjour, je vous contacte depuis votre fiche CornerGood « ${listingName} ».`,
  );
  return `https://wa.me/${e164.replace(/^\+/, "")}?text=${text}`;
}

/** Opens the phone's map application on the way to the point. */
export function directionsLink(point: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`;
}
