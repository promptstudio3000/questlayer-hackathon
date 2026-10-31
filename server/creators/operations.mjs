import { atomic } from "../database.mjs";
import { assert, hash } from "../domain.mjs";

export const creatorAssert = (
  condition,
  message,
  code = "CREATOR_CONFLICT",
  status = 409,
) => assert(condition, message, status, code);
export function creatorKey(value) {
  creatorAssert(
    typeof value === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value),
    "Invalid creator identifier.",
    "CREATOR_INPUT",
    400,
  );
  return value;
}
export function creatorInteger(value, min = 0) {
  creatorAssert(
    Number.isSafeInteger(value) && value >= min,
    "Invalid creator integer.",
    "CREATOR_INPUT",
    400,
  );
  return value;
}
export function creatorText(value, max, { optional = false } = {}) {
  creatorAssert(
    typeof value === "string" &&
      value.length <= max &&
      (optional || value.trim().length > 0) &&
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
    "Invalid creator text.",
    "CREATOR_INPUT",
    400,
  );
  return value.trim();
}
export function creatorFields(value, names) {
  creatorAssert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === [...names].sort().join(),
    "Unexpected or missing creator fields.",
    "CREATOR_INPUT",
    400,
  );
}
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );

// All creator services share one actor-scoped receipt namespace and write lock.
// creator_operations is created by explicit lifecycle initialization.
export function createCreatorOperations(db, { clock = Date.now } = {}) {
  return (command, actor, operationId, input, perform) => {
    creatorKey(actor);
    creatorKey(operationId);
    const fingerprint = hash(canonical({ command, input }));
    return atomic(db, () => {
      const existing = db
        .prepare(
          "SELECT * FROM creator_operations WHERE actor=? AND operation_id=?",
        )
        .get(actor, operationId);
      if (existing) {
        creatorAssert(
          existing.fingerprint === fingerprint,
          "This operation ID already identifies another creator action.",
          "CREATOR_OPERATION_REUSED",
        );
        return JSON.parse(existing.receipt);
      }
      const now = creatorInteger(clock());
      const result = perform(now);
      creatorAssert(
        !result?.then,
        "Creator mutations must be synchronous.",
        "CREATOR_STORAGE",
        500,
      );
      const receipt = {
        domain: "demo",
        operationId,
        command,
        confirmedAt: now,
        ...result,
      };
      const encoded = JSON.stringify(receipt);
      db.prepare("INSERT INTO creator_operations VALUES (?,?,?,?,?,?)").run(
        actor,
        operationId,
        command,
        fingerprint,
        encoded,
        now,
      );
      return JSON.parse(encoded);
    });
  };
}
