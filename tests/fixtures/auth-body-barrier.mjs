// Test-only IPC signal when the live HTTP handler starts consuming the delayed body.
import { IncomingMessage } from "node:http";
const read = IncomingMessage.prototype[Symbol.asyncIterator];
IncomingMessage.prototype[Symbol.asyncIterator] = async function* () {
  for await (const chunk of read.call(this)) {
    if (this.headers["x-test-body-barrier"]) process.send?.("reading-body");
    yield chunk;
  }
};
