// Public refreshes share one read and cannot replace a newer worker observation.
export function publicDistribution(native, auditDistribution, now = Date.now) {
  let pending;
  return async function read(refresh) {
    const cached = native.lastAudit;
    if (!cached || (refresh && now() - cached.observedAt >= 30_000)) {
      pending ??= auditDistribution(native)
        .then((audit) => {
          if (
            !native.lastAudit ||
            native.lastAudit.observedAt <= audit.observedAt
          )
            native.lastAudit = audit;
        })
        .finally(() => {
          pending = undefined;
        });
      await pending;
    }
    return publicAudit(native.lastAudit);
  };
}
export function publicAudit(audit) {
  return audit?.reason
    ? { ...audit, reason: "The verification service is unavailable." }
    : audit;
}
