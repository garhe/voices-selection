export function startPolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  onValue: (value: T) => void,
  onError: (error: unknown) => void,
  interval = 2000,
): () => void {
  let stopped = false;
  let next: ReturnType<typeof setTimeout> | undefined;
  let current: AbortController | undefined;
  async function tick() {
    const attempt = new AbortController();
    current = attempt;
    const timeout = setTimeout(() => attempt.abort(new Error('Local app response timed out.')), 10000);
    try {
      const value = await load(attempt.signal);
      if (!stopped) onValue(value);
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      clearTimeout(timeout);
      attempt.abort();
      current = undefined;
      if (!stopped) next = setTimeout(() => void tick(), interval);
    }
  }
  void tick();
  return () => {
    stopped = true;
    clearTimeout(next);
    current?.abort();
  };
}
