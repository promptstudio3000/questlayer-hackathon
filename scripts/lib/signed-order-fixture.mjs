// Regenerates tests/fixtures/signed-aura-order.json: a deterministic NEP-413
// order signed in Node with the seed [1; 32], which the Rust market tests
// verify byte-for-byte. Test data only; the seed is public.
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { baseEncode } from "near-api-js";
import { nep413Digest, orderMessage, orderTerms, signedOrder } from "../../server/native/signed-orders.mjs";
const seed = Buffer.alloc(32, 1),
  key = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8",
  }),
  publicKey = `ed25519:${baseEncode(createPublicKey(key).export({ type: "spki", format: "der" }).subarray(-32))}`,
  message = orderMessage(
    orderTerms({
      kind: "sell",
      market: "market.testnet",
      nftContract: "nfts.testnet",
      maker: "seller.testnet",
      tokenId: "aura:polar:1",
      price: 10n * 10n ** 24n,
      deadlineMs: 1_793_000_000_000 + 3_600_000,
    }),
  ),
  nonce = Buffer.alloc(32, 7),
  recipient = "market.testnet",
  signature = sign(null, nep413Digest({ message, nonce, recipient }), key);
writeFileSync(
  new URL("../../tests/fixtures/signed-aura-order.json", import.meta.url),
  JSON.stringify(signedOrder({ message, nonce, recipient, publicKey, signature }), null, 2) + "\n",
);
