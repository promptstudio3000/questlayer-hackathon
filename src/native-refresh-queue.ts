type RefreshBatch = {
  context: string;
  fresh: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

/** One active read and at most one follow-up, owned by the latest context. */
export function createNativeRefreshQueue(
  run: (context: string, fresh: boolean) => Promise<void>,
) {
  let active: RefreshBatch | null = null;
  let pending: RefreshBatch | null = null;
  const batch = (context: string, fresh: boolean): RefreshBatch => {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { context, fresh, promise, resolve, reject };
  };
  const execute = async (request: RefreshBatch) => {
    active = request;
    try {
      await run(request.context, request.fresh);
      request.resolve();
    } catch (error) {
      request.reject(error);
    } finally {
      active = null;
      const next = pending;
      pending = null;
      if (next) void execute(next);
    }
  };
  return {
    request(context: string, fresh = false): Promise<void> {
      if (!active) {
        const first = batch(context, fresh);
        void execute(first);
        return first.promise;
      }
      if (pending?.context === context) {
        pending.fresh ||= fresh;
        return pending.promise;
      }
      // Ordinary polling can share an active read. An explicit fresh request
      // must observe changes made after that read began, so it queues a new one.
      if (active.context === context && !fresh && !pending)
        return active.promise;
      pending?.resolve();
      pending = batch(context, fresh);
      return pending.promise;
    },
    cancelPending() {
      pending?.resolve();
      pending = null;
    },
  };
}
