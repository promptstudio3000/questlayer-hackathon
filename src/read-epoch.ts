export type ReadEpochToken = Readonly<{ context: string }>;

/** Fence asynchronous reads by both request order and the current owner/realm.
 * begin(context) starts a newer read, isCurrent(token, currentContext) must be
 * checked after awaiting it, and invalidate() fences all outstanding reads.
 * Tokens stay in memory and are never receipts, consent or persisted state.
 */
export function createReadEpoch() {
  let latest: ReadEpochToken | null = null;
  return {
    begin(context: string): ReadEpochToken {
      latest = Object.freeze({ context });
      return latest;
    },
    isCurrent(token: ReadEpochToken, currentContext: string) {
      return token === latest && token.context === currentContext;
    },
    invalidate() {
      latest = null;
    },
  };
}
