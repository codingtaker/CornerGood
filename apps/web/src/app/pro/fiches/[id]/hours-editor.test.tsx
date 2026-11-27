import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { OpeningHours } from "@/lib/listings";
import { HoursEditor, hoursState, openingHours } from "./hours-editor";

const week: OpeningHours = {
  mon: [
    ["08:00", "12:00"],
    ["14:00", "18:00"],
  ],
  sun: [],
};

function Harness({ initial }: { initial: OpeningHours | null }) {
  const [value, setValue] = useState(() => hoursState(initial));
  return (
    <>
      <HoursEditor value={value} onChange={setValue} />
      <output data-testid="sent">{JSON.stringify(openingHours(value))}</output>
    </>
  );
}
const sent = () =>
  JSON.parse(screen.getByTestId("sent").textContent ?? "null") as unknown;

describe("HoursEditor", () => {
  afterEach(cleanup);

  it("gives back what the API sent, days not said left out", () => {
    expect(openingHours(hoursState(week))).toEqual(week);
    expect(openingHours(hoursState(null))).toBeNull();
  });

  it("opens a day with one range, then adds a break", () => {
    render(<Harness initial={null} />);
    fireEvent.change(screen.getByLabelText("Mardi : ouverture"), {
      target: { value: "open" },
    });
    expect(sent()).toEqual({ tue: [["08:00", "18:00"]] });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une pause" }));
    expect(sent()).toEqual({
      tue: [
        ["08:00", "12:00"],
        ["14:00", "18:00"],
      ],
    });
  });

  it("copies Monday to Tuesday through Saturday, not Sunday", () => {
    render(<Harness initial={week} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mêmes horaires que le lundi, du mardi au samedi",
      }),
    );
    const hours = sent() as OpeningHours;
    expect(hours.sat).toEqual(week.mon);
    expect(hours.tue).toEqual(week.mon);
    expect(hours.sun).toEqual([]);
  });
});
