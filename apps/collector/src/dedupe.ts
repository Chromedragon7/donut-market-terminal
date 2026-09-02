export interface PageTransactionOccurrence<T> {
  readonly record: T;
  readonly page: number;
  readonly fingerprint: string;
  readonly occurrenceOrdinal: number;
  readonly collisionAmbiguous: boolean;
}

export interface ReconciledTransactionOccurrence<T> extends PageTransactionOccurrence<T> {
  readonly repeatedAcrossPages: boolean;
}

/**
 * Keeps the maximum multiplicity proven on any one page while preventing a
 * moving page boundary from manufacturing extra logical sales. Every source
 * row remains an observation; cross-page identity stays explicitly ambiguous.
 */
export function reconcileTransactionPageOccurrences<T>(
  records: readonly PageTransactionOccurrence<T>[],
): readonly ReconciledTransactionOccurrence<T>[] {
  const pagesByFingerprint = new Map<string, Set<number>>();
  for (const entry of records) {
    if (!Number.isSafeInteger(entry.occurrenceOrdinal) || entry.occurrenceOrdinal < 1) {
      throw new TypeError("Transaction occurrence ordinals must be positive safe integers");
    }
    let pages = pagesByFingerprint.get(entry.fingerprint);
    if (pages === undefined) {
      pages = new Set<number>();
      pagesByFingerprint.set(entry.fingerprint, pages);
    }
    pages.add(entry.page);
  }

  return Object.freeze(records.map((entry) => {
    const repeatedAcrossPages = (pagesByFingerprint.get(entry.fingerprint)?.size ?? 0) > 1;
    return Object.freeze({
      ...entry,
      collisionAmbiguous: entry.collisionAmbiguous || repeatedAcrossPages,
      repeatedAcrossPages,
    });
  }));
}
