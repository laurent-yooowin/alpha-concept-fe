export function budgetReportCoverage(affectedReports: number, organizationReports: number): number {
  if (!Number.isFinite(affectedReports) || !Number.isFinite(organizationReports) || organizationReports <= 0) return 0;
  return Math.max(0, Math.min(100, affectedReports / organizationReports * 100));
}
