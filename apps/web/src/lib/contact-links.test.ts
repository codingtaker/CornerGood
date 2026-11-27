import { describe, expect, it } from "vitest";
import {
  callLink,
  directionsLink,
  displayPhone,
  whatsappLink,
} from "./contact-links";

describe("contact links", () => {
  it("shows a Togolese number the local way", () => {
    expect(displayPhone("+22890123456")).toBe("90 12 34 56");
    expect(displayPhone("+33612345678")).toBe("+33612345678");
  });

  it("builds call, WhatsApp and directions links", () => {
    expect(callLink("+22890123456")).toBe("tel:+22890123456");
    const whatsapp = new URL(whatsappLink("+22890123456", "Atelier Afi"));
    expect(whatsapp.origin + whatsapp.pathname).toBe(
      "https://wa.me/22890123456",
    );
    expect(whatsapp.searchParams.get("text")).toContain("« Atelier Afi »");
    expect(directionsLink({ lat: 6.1319, lng: 1.2228 })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=6.1319,1.2228",
    );
  });
});
