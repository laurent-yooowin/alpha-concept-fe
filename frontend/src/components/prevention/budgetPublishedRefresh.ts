/** Re-read the published selection after a job: ALL may reconcile after the job ends. */
export function scheduleBudgetPublishedRefresh(
  refresh: () => Promise<void>,
  isCurrentSelection: () => boolean,
  onError: (reason: unknown) => void,
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> = setTimeout,
  attempts = 10,
  intervalMs = 3000,
): Array<ReturnType<typeof setTimeout>> {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    timers.push(schedule(() => {
      if (isCurrentSelection()) void refresh().catch(onError);
    }, attempt * intervalMs));
  }
  return timers;
}
