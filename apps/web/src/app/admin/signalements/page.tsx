import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDate } from "@/lib/listings";
import {
  REASON_LABELS,
  REPORT_STATUS_LABELS,
  type ReportSummary,
} from "@/lib/reports";
import { ADMIN_ROLES, apiFetch, getCurrentUser } from "@/lib/session";
import { AccessDenied } from "../access-denied";

export const metadata: Metadata = { title: "Signalements · CornerGood" };

const FILTERS = [
  { status: "", label: "Tous" },
  { status: "OPEN", label: "À traiter" },
  { status: "IN_REVIEW", label: "Pris en charge" },
  { status: "RESOLVED", label: "Résolus" },
  { status: "DISMISSED", label: "Classés" },
];

/** Reports of visitors, those to handle first (contract §6.5). */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?suivant=/admin/signalements");
  if (!ADMIN_ROLES.includes(user.role)) return <AccessDenied />;

  const { statut = "" } = await searchParams;
  const filter = FILTERS.find((f) => f.status === statut) ?? FILTERS[0];
  const response = await apiFetch(
    `/admin/reports${filter.status ? `?status=${filter.status}` : ""}`,
  );
  const reports = response.ok
    ? ((await response.json()) as { reports: ReportSummary[] }).reports
    : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-8">
      <div>
        <Link href="/admin" className="text-sm text-accent underline">
          Modération
        </Link>
        <h1 className="text-2xl font-bold">Signalements</h1>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Filtrer par état">
        {FILTERS.map((f) => (
          <Link
            key={f.status}
            href={
              f.status
                ? `/admin/signalements?statut=${f.status}`
                : "/admin/signalements"
            }
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              f === filter
                ? "border-accent bg-accent text-white"
                : "border-foreground/30"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {reports === null && (
        <p role="alert">Les signalements sont indisponibles pour le moment.</p>
      )}
      {reports?.length === 0 && (
        <p role="status" className="opacity-80">
          Aucun signalement ici.
        </p>
      )}
      {reports && reports.length > 0 && (
        <ol className="flex flex-col gap-3">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                href={`/admin/signalements/${report.id}`}
                className="flex flex-col gap-1 rounded-md border border-foreground/20 p-4 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="text-sm font-medium text-accent">
                  {REPORT_STATUS_LABELS[report.status] ?? report.status}
                  {report.handledBy && ` · ${report.handledBy}`}
                </span>
                <span className="font-semibold">{report.listing.name}</span>
                <span className="text-sm opacity-80">
                  {REASON_LABELS[report.reason] ?? report.reason}
                </span>
                <span className="text-sm opacity-70">
                  Reçu le {formatDate(report.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
