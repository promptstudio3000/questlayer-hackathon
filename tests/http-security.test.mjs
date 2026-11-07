import test from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress, RateWindows, pruneRateWindows, publicRpcUrl } from '../server/http-security.mjs';

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

test("pressure cannot clear an active rate limit; new windows reopen next minute", () => {
 let now=60_100;
 const rates=new RateWindows(2,()=>now);
 rates.set("guest:a:1",30); rates.set("guest:b:1",1);
 assert.throws(()=>rates.set("guest:c:1",1), error=>error.status===429);
 pruneRateWindows(rates,now);
 assert.equal(rates.get("guest:a:1"),30);
 rates.set("guest:a:1",31); assert.equal(rates.size,2);
 now+=60_000;
 rates.set("guest:c:2",1); assert.equal(rates.size,1);
});
test("browser RPC selects the network default and rejects inline credentials", () => {
 assert.equal(new URL(publicRpcUrl(undefined, "https://example.test")).origin,"https://example.test");
 for(const value of ["https://name:password@example.test","https://example.test/?key=fixture","http://example.test/rpc"])
   assert.throws(()=>publicRpcUrl(value,"https://fallback.test"));
});
