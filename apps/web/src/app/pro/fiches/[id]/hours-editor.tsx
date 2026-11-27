"use client";

import { DAY_LABELS, DAYS, type Day, type OpeningHours } from "@/lib/listings";

type Mode = "unknown" | "closed" | "open";
export interface DayState {
  mode: Mode;
  /** One or two ranges; a second one is a break at midday. */
  ranges: [string, string][];
}
export type HoursState = Record<Day, DayState>;

const DEFAULT_RANGE: [string, string] = ["08:00", "18:00"];

/** The editor's state from what the API returned. */
export function hoursState(hours: OpeningHours | null): HoursState {
  return Object.fromEntries(
    DAYS.map((day) => {
      const ranges = hours?.[day];
      const state: DayState =
        ranges === undefined
          ? { mode: "unknown", ranges: [DEFAULT_RANGE] }
          : ranges.length === 0
            ? { mode: "closed", ranges: [DEFAULT_RANGE] }
            : { mode: "open", ranges };
      return [day, state];
    }),
  ) as HoursState;
}

/** What the API expects: unknown days left out, null when nothing is said. */
export function openingHours(state: HoursState): OpeningHours | null {
  const hours: OpeningHours = {};
  for (const day of DAYS) {
    const { mode, ranges } = state[day];
    if (mode === "closed") hours[day] = [];
    if (mode === "open") hours[day] = ranges;
  }
  return Object.keys(hours).length > 0 ? hours : null;
}

const time = "rounded-md border border-foreground/30 px-2 py-1 text-base";

/**
 * Opening hours, day by day: not said, closed, or open with one or two
 * ranges (contract §5.1). "Même horaires" copies Monday to the other
 * working days, the common case.
 */
export function HoursEditor({
  value,
  onChange,
}: {
  value: HoursState;
  onChange: (value: HoursState) => void;
}) {
  const set = (day: Day, state: DayState) =>
    onChange({ ...value, [day]: state });
  const setTime = (day: Day, index: number, end: 0 | 1, text: string) => {
    const ranges = value[day].ranges.map((range, i) =>
      i === index
        ? ((end === 0 ? [text, range[1]] : [range[0], text]) as [
            string,
            string,
          ])
        : range,
    );
    set(day, { ...value[day], ranges });
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-medium">Horaires d&apos;ouverture</legend>
      {DAYS.map((day) => {
        const state = value[day];
        return (
          <div key={day} className="flex flex-col gap-1">
            <label className="flex items-center justify-between gap-2">
              <span className="w-24">{DAY_LABELS[day]}</span>
              <select
                value={state.mode}
                onChange={(event) =>
                  set(day, { ...state, mode: event.target.value as Mode })
                }
                aria-label={`${DAY_LABELS[day]} : ouverture`}
                className="flex-1 rounded-md border border-foreground/30 px-2 py-1 text-base"
              >
                <option value="unknown">Non précisé</option>
                <option value="closed">Fermé</option>
                <option value="open">Ouvert</option>
              </select>
            </label>
            {state.mode === "open" && (
              <div className="flex flex-col gap-1 pl-24">
                {state.ranges.map((range, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={range[0]}
                      onChange={(event) =>
                        setTime(day, index, 0, event.target.value)
                      }
                      aria-label={`${DAY_LABELS[day]} : ouvre à`}
                      className={time}
                    />
                    <span aria-hidden>–</span>
                    <input
                      type="time"
                      value={range[1]}
                      onChange={(event) =>
                        setTime(day, index, 1, event.target.value)
                      }
                      aria-label={`${DAY_LABELS[day]} : ferme à`}
                      className={time}
                    />
                  </div>
                ))}
                {state.ranges.length === 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      set(day, {
                        ...state,
                        ranges: [
                          [state.ranges[0][0], "12:00"],
                          ["14:00", state.ranges[0][1]],
                        ],
                      })
                    }
                    className="self-start text-sm text-accent underline"
                  >
                    Ajouter une pause
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      set(day, {
                        ...state,
                        ranges: [[state.ranges[0][0], state.ranges[1][1]]],
                      })
                    }
                    className="self-start text-sm text-accent underline"
                  >
                    Sans pause
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            ...Object.fromEntries(
              (["tue", "wed", "thu", "fri", "sat"] as const).map((day) => [
                day,
                { ...value.mon, ranges: [...value.mon.ranges] },
              ]),
            ),
          })
        }
        className="self-start text-sm text-accent underline"
      >
        Mêmes horaires que le lundi, du mardi au samedi
      </button>
    </fieldset>
  );
}
