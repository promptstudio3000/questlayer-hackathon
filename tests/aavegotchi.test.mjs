import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionResult } from 'viem';
import { AAVEGOTCHI_ABI } from '../server/aavegotchi.mjs';

test('Aavegotchi inventory decodes the canonical item ID before the quantity', () => {
 // Wire fixture: dynamic offset, array length, item ID 73, quantity 2.
 // ItemsFacet.ItemIdIO is declared as { itemId, balance } upstream.
 const data = '0x' + [32,1,73,2].map(n=>BigInt(n).toString(16).padStart(64,'0')).join('');
 for (const functionName of ['itemBalances','itemBalancesOfToken']) {
  const result = decodeFunctionResult({abi:AAVEGOTCHI_ABI,functionName,data});
  assert.deepEqual(result,[{itemId:73n,balance:2n}]);
 }
});
