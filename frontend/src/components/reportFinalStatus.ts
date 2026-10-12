export function isFinalReportStatus(status: string | null | undefined): boolean {
  return status === 'envoye_au_client' || status === 'archive';
}
