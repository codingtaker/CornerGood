import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatDate, STATUS_LABELS } from "@/lib/listings";
import {
  REASON_LABELS,
  REPORT_STATUS_LABELS,
  type ReportDetail,
} from "@/lib/reports";
import { ADMIN_ROLES, apiFetch, getCurrentUser } from "@/lib/session";
import { AccessDenied } from "../../access-denied";
import { ReportActions } from "./report-actions";

export const metadata: Metadata = { title: "Signalement · CornerGood" };

const VERIFICATION_LABELS: Record<string, string> = {
  UNVERIFIED: "Non vérifiée",
  VERIFIED: "Vérifiée",
  VERIFICATION_PENDING: "Vérification à refaire",
};

/** One report, the listing it is about, and its handling. */
export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?suivant=/admin/signalements/${id}`);
  if (!ADMIN_ROLES.includes(user.role)) return <AccessDenied />;

  const response = await apiFetch(`/admin/reports/${encodeURIComponent(id)}`);
  if (response.status === 404) notFound();
  if (!response.ok) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <p role="alert">Le signalement est indisponible pour le moment.</p>
      </main>
    );
  }
  const { report } = (await response.json()) as { report: ReportDetail };
  const closed = report.status === "RESOLVED" || report.status === "DISMISSED";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-8">
      <div>
        <Link
          href="/admin/signalements"
          className="text-sm text-accent underline"
        >
          Signalements
        </Link>
        <p className="mt-2 text-sm font-medium text-accent">
          {REPORT_STATUS_LABELS[report.status] ?? report.status}
          {report.handledBy && ` · ${report.handledBy}`}
        </p>
        <h1 className="text-2xl font-bold">
          {REASON_LABELS[report.reason] ?? report.reason}
        </h1>
        <p className="text-sm opacity-70">
          Reçu le {formatDate(report.createdAt)}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Message</h2>
        <p className="whitespace-pre-line">{report.description}</p>
        <p className="text-sm">
          Contact :{" "}
          {report.reporterContact ?? (
            <span className="opacity-70">aucun, la personne reste anonyme</span>
          )}
        </p>
      </section>

      <section className="flex flex-col gap-1 rounded-md border border-foreground/20 p-4">
        <h2 className="text-lg font-semibold">{report.listing.name}</h2>
        <p className="text-sm opacity-80">
          {STATUS_LABELS[report.listing.status] ?? report.listing.status} ·{" "}
          {VERIFICATION_LABELS[report.listing.verificationStatus] ??
            report.listing.verificationStatus}
        </p>
        <Link
          href={`/admin/fiches/${report.listing.id}`}
          className="text-accent underline"
        >
          Ouvrir la fiche dans le back-office
        </Link>
        {report.listing.status === "PUBLISHED" && (
          <Link
            href={`/fiches/${report.listing.slug}`}
            className="text-accent underline"
          >
            Voir la page publique
          </Link>
        )}
      </section>

      {closed ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Note de traitement</h2>
          <p className="whitespace-pre-line">{report.resolutionNote}</p>
          {report.resolvedAt && (
            <p className="text-sm opacity-70">
              Clos le {formatDate(report.resolvedAt)}
            </p>
          )}
        </section>
      ) : (
        <>
          <ReportActions reportId={report.id} status={report.status} />
          <p className="text-sm opacity-70">
            Clore un signalement ne modifie pas la fiche : corrigez-la ou
            suspendez-la depuis sa page.
          </p>
        </>
      )}
    </main>
  );
}
