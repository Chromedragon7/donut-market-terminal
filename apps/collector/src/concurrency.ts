/**
 * Ordered bounded concurrency. On the first failure no new work is claimed,
 * already-running operations are drained, and then the original error is
 * rethrown so callers never close shared resources under background writes.
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive safe integer");
  }
  if (values.length === 0) return [];

  const results = new Map<number, R>();
  let nextIndex = 0;
  let failure: unknown;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = nextIndex;
      if (index >= values.length) return;
      nextIndex += 1;
      const value = values[index] as T;
      try {
        results.set(index, await operation(value, index));
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  };

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  if (failed) throw failure;
  return values.map((_value, index) => {
    if (!results.has(index)) throw new Error("Concurrent work completed without a result");
    return results.get(index)!;
  });
}
