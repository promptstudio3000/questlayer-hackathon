import { GameError } from "../domain.mjs";

// Worker-side failure with an explicit retry verdict. A terminal error ends the
// job; a non-terminal one schedules another attempt with backoff.
export class RelayJobError extends GameError {
  constructor(
    code,
    message,
    { terminal = true, topup = false, status = 409 } = {},
  ) {
    super(message, status, code);
    this.name = "RelayJobError";
    this.terminal = terminal;
    this.topup = topup;
  }
}
export const terminal = (code, message) => new RelayJobError(code, message);
export const retryLater = (code, message) =>
  new RelayJobError(code, message, { terminal: false, status: 503 });
