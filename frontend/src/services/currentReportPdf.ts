export async function currentReportPdfData(
  reportId: string,
  fileName: string,
  resolvePdf: (id: string, name: string) => Promise<{ base64?: string | null; contentType?: string; fileName?: string }>,
): Promise<{ base64: string; contentType: string; fileName?: string }> {
  const resolved = await resolvePdf(reportId, fileName);
  if (!resolved?.base64) throw new Error('Aucun PDF disponible');
  return { base64: resolved.base64, contentType: resolved.contentType || 'application/pdf', fileName: resolved.fileName };
}
