import { redirect } from "next/navigation";

// The report page lives at /reports/[id] (attempt-scoped). This redirect
// keeps any old /attempts/{id}/report links from 404ing.
export default function AttemptReportRedirect({ params }: { params: { id: string } }) {
  redirect(`/reports/${params.id}`);
}
