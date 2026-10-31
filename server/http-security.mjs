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
