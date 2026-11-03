import { isIP } from 'node:net';

// Only the explicitly trusted loopback proxy may supply a client address.
// Its rightmost hop cannot be replaced by a client-supplied prefix.
export function clientAddress(req, trustLoopback = false) {
 const remote = req.socket.remoteAddress || 'unknown';
 const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
 const forwarded = req.headers['x-forwarded-for'];
 if (!trustLoopback || !local || typeof forwarded !== 'string') return remote;
 const last = forwarded.split(',').at(-1).trim();
 return isIP(last) ? last : remote;
}

// Fixed one-minute rate windows are keyed "<scope>:<who>:<minute>". Drop
// windows that ended instead of clearing every counter (a flood of keys must
// not reset everyone's limits); a hard ceiling still bounds memory.
export function pruneRateWindows(rates, now = Date.now(), ceiling = 200_000) {
  const minute = Math.floor(now / 60_000);
  for (const key of rates.keys()) {
    const at = Number(key.slice(key.lastIndexOf(':') + 1));
    if (!Number.isFinite(at) || at < minute) rates.delete(key);
  }
  if (rates.size > ceiling) rates.clear();
  return rates.size;
}
