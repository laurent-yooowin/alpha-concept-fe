/** The list in the current render predates the successful activation PATCH. */
export function activatedOrganization<T extends { id: string; isActive: boolean }>(organization: T, id: string): T {
  return { ...organization, id, isActive: true };
}
