import {
  DAY_LABELS,
  DAYS,
  type ListedService,
  type OpeningHours,
} from "@/lib/listings";

/** "08:00" → "8 h", "14:30" → "14 h 30", as written in Lomé. */
export function frenchTime(time: string): string {
  const [hours, minutes] = time.split(":");
  return `${Number(hours)} h${minutes === "00" ? "" : ` ${minutes}`}`;
}

/** The week, day by day; days not said are left out. */
export function OpeningHoursTable({ hours }: { hours: OpeningHours }) {
  const days = DAYS.filter((day) => hours[day] !== undefined);
  return (
    <table className="w-full text-left">
      <caption className="sr-only">Horaires d&apos;ouverture</caption>
      <tbody>
        {days.map((day) => {
          const ranges = hours[day] ?? [];
          return (
            <tr key={day} className="border-b border-foreground/10">
              <th scope="row" className="py-1 pr-4 font-medium">
                {DAY_LABELS[day]}
              </th>
              <td className="py-1">
                {ranges.length === 0
                  ? "Fermé"
                  : ranges
                      .map(
                        ([from, to]) =>
                          `${frenchTime(from)} – ${frenchTime(to)}`,
                      )
                      .join(", ")}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ServicesList({ services }: { services: ListedService[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {services.map((service) => (
        <li key={service.id}>
          <span className="font-medium">{service.name}</span>
          {service.details && (
            <span className="opacity-80"> : {service.details}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
