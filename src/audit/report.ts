import type { AuditCheck, AuditReport } from "./types.js";

export function scoreAuditChecks(checks: AuditCheck[]): number {
  const relevant = checks.filter((item) => item.status !== "na");
  const total = relevant.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return 0;
  const earned = relevant.reduce(
    (sum, item) =>
      sum + (item.status === "pass" ? item.weight : item.status === "warn" ? item.weight / 2 : 0),
    0,
  );
  return Math.round((earned / total) * 100);
}

export function formatAuditReport(report: AuditReport): string {
  const lines = [`${report.target}: ${report.score}/100`, ""];
  for (const item of report.checks)
    lines.push(`${item.status.toUpperCase().padEnd(4)}  ${item.id}: ${item.note}`);
  lines.push("", "Gaps:");
  if (!report.gaps.length) lines.push("None.");
  else report.gaps.forEach((gap, index) => lines.push(`${index + 1}. ${gap.id}: ${gap.fix}`));
  return lines.join("\n");
}
