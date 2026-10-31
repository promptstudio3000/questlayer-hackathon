import test from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress } from '../server/http-security.mjs';

const request = (remote, forwarded) => ({socket:{remoteAddress:remote},headers:{'x-forwarded-for':forwarded}});
test('forwarded addresses cannot bypass the client limit from an untrusted connection', () => {
 assert.equal(clientAddress(request('203.0.113.8','198.51.100.9'),true),'203.0.113.8');
 assert.equal(clientAddress(request('127.0.0.1','198.51.100.9')),'127.0.0.1');
});
test('the trusted local proxy separates clients and ignores forged address prefixes', () => {
 assert.equal(clientAddress(request('127.0.0.1','198.51.100.9'),true),'198.51.100.9');
 assert.equal(clientAddress(request('127.0.0.1','forged, 198.51.100.10'),true),'198.51.100.10');
 assert.equal(clientAddress(request('::1','not-an-address'),true),'::1');
 assert.equal(clientAddress(request('::ffff:127.0.0.1','2001:db8::1'),true),'2001:db8::1');
});
