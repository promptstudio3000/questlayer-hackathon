import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  cellKey,
  naturalCell,
  GRID_SIZE,
  MAX_HEIGHT,
} from "./model.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const workshopId = (actor) => `w_${digest(actor).slice(0, 32)}`;
const validId = (id) => typeof id === "string" && /^w_[a-f0-9]{32}$/.test(id);
function check(ok, message, status = 400, code = "WORKSHOP_INVALID") {
  if (!ok) throw Object.assign(new Error(message), { status, code });
}
function cleanActor(actor) {
  check(
    actor &&
      typeof actor.id === "string" &&
      actor.id.length > 0 &&
      actor.id.length <= 160,
    "Please sign in again.",
    401,
  );
  check(
    typeof actor.name === "string" && actor.name.length <= 100,
    "Please sign in again.",
    401,
  );
}

/** Separate, private files. No financial database, reward table or chain adapter. */
export function createWorkshopStore({
  directory,
  now = Date.now,
  beforeCommit = () => {},
}) {
  const root = resolve(directory);
  const visitors = new Map();
  function file(id) {
    check(validId(id), "Choose a valid workshop.");
    return resolve(root, `${id}.json`);
  }
  function read(id) {
    const path = file(id);
    check(
      existsSync(path),
      "This workshop is not available.",
      404,
      "WORKSHOP_MISSING",
    );
    const raw = readFileSync(path, "utf8");
    check(raw.length <= 250000, "Workshop storage needs review.", 503);
    const data = JSON.parse(raw);
    check(
      data.schema === 1 &&
        data.id === id &&
        Number.isSafeInteger(data.revision),
      "Workshop storage needs review.",
      503,
    );
    return data;
  }
  function allowed(data, actor) {
    return (
      data.ownerId === actor.id || data.members.some((m) => m.id === actor.id)
    );
  }
  function requireAccess(data, actor, owner = false) {
    check(
      owner ? data.ownerId === actor.id : allowed(data, actor),
      "You do not have access to this workshop.",
      403,
      "WORKSHOP_FORBIDDEN",
    );
  }
  function view(data, actor) {
    requireAccess(data, actor);
    const present = visitors.get(data.id) || new Map();
    for (const [id, visitor] of present) {
      if (
        visitor.seenAt <= now() - 20000 ||
        (id !== data.ownerId && !data.members.some((m) => m.id === id))
      )
        present.delete(id);
    }
    return {
      id: data.id,
      ownerName: data.ownerName,
      revision: data.revision,
      cells: data.cells,
      role: data.ownerId === actor.id ? "owner" : "editor",
      members: data.ownerId === actor.id ? data.members : [],
      visitors: [...present.values()]
        .filter((v) => v.id !== actor.id)
        .map(({ seenAt, ...v }) => v),
      progress: data.progress,
    };
  }
  function transaction(id, update) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const lock = file(id) + ".lock";
    let handle;
    try {
      handle = openSync(lock, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST")
        check(
          false,
          "This workshop is being saved. Try again shortly.",
          503,
          "WORKSHOP_BUSY",
        );
      throw error;
    }
    const temporary = file(id) + `.${randomUUID()}.tmp`;
    try {
      const result = update();
      if (!result.data) return result.value;
      const contents = JSON.stringify(result.data);
      check(
        contents.length <= 250000,
        "This workshop has reached its storage limit.",
        409,
      );
      beforeCommit(result.data);
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, contents);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, file(id));
      const dir = openSync(root, "r");
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
      return result.value;
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
      closeSync(handle);
      unlinkSync(lock);
    }
  }
  function open(actor) {
    cleanActor(actor);
    const id = workshopId(actor.id);
    return transaction(id, () => {
      if (existsSync(file(id))) return { value: view(read(id), actor) };
      check(
        readdirSync(root).filter((n) => /^w_[a-f0-9]{32}\.json$/.test(n))
          .length < 4096,
        "New workshops are paused while space is added.",
        503,
        "WORKSHOP_CAPACITY",
      );
      const data = {
        schema: 1,
        id,
        ownerId: actor.id,
        ownerName: actor.name,
        revision: 0,
        cells: {},
        members: [],
        invite: null,
        receipts: [],
        progress: { shaped: 0, lantern: false, completedAt: null },
      };
      return { data, value: view(data, actor) };
    });
  }
  function get(actor, id) {
    cleanActor(actor);
    return view(read(id), actor);
  }
  function edit(actor, input) {
    cleanActor(actor);
    check(input && validId(input.workshopId), "Choose a valid workshop.");
    const { x, z, cell, requestId, revision } = input;
    check(
      Number.isInteger(x) &&
        x >= 0 &&
        x < GRID_SIZE &&
        Number.isInteger(z) &&
        z >= 0 &&
        z < GRID_SIZE,
      "Choose a block inside this workshop.",
    );
    check(
      cell &&
        Number.isInteger(cell.height) &&
        cell.height >= 0 &&
        cell.height <= MAX_HEIGHT &&
        ["grass", "stone", "sand", "water"].includes(cell.material) &&
        [null, "lantern"].includes(cell.object),
      "Choose a valid block.",
    );
    check(
      typeof requestId === "string" &&
        /^[a-zA-Z0-9_-]{16,80}$/.test(requestId) &&
        Number.isSafeInteger(revision) &&
        revision >= 0,
      "Start a new edit.",
    );
    const intent = digest(
      JSON.stringify([x, z, cell.height, cell.material, cell.object, revision]),
    );
    return transaction(input.workshopId, () => {
      const data = read(input.workshopId);
      requireAccess(data, actor);
      const receipt = data.receipts.find(
        (r) => r.actor === actor.id && r.id === requestId,
      );
      if (receipt) {
        check(
          receipt.intent === intent,
          "This edit ID was already used for a different change.",
          409,
          "WORKSHOP_REPLAY",
        );
        return { value: { workshop: view(data, actor), alreadySaved: true } };
      }
      check(
        data.revision === revision,
        "Someone changed this workshop. Refresh before editing again.",
        409,
        "WORKSHOP_CONFLICT",
      );
      const next = {
        height: cell.height,
        material: cell.material,
        object: cell.object,
      };
      if (JSON.stringify(next) === JSON.stringify(naturalCell(x, z)))
        delete data.cells[cellKey(x, z)];
      else data.cells[cellKey(x, z)] = next;
      data.revision++;
      data.progress.shaped = Object.keys(data.cells).length;
      data.progress.lantern = Object.values(data.cells).some(
        (c) => c.object === "lantern",
      );
      if (
        !data.progress.completedAt &&
        data.progress.shaped >= 3 &&
        data.progress.lantern
      )
        data.progress.completedAt = now();
      data.receipts.push({ actor: actor.id, id: requestId, intent });
      data.receipts = data.receipts.slice(-256);
      return {
        data,
        value: { workshop: view(data, actor), alreadySaved: false },
      };
    });
  }
  function invite(actor, id) {
    cleanActor(actor);
    const nonce = randomBytes(24).toString("hex"),
      expiresAt = now() + 86400000;
    return transaction(id, () => {
      const data = read(id);
      requireAccess(data, actor, true);
      check(
        data.members.length < 12,
        "This workshop already has twelve friends.",
        409,
      );
      data.invite = { hash: digest(nonce), expiresAt };
      data.revision++;
      return {
        data,
        value: {
          token: `${id}.${nonce}`,
          expiresAt,
          workshop: view(data, actor),
        },
      };
    });
  }
  function join(actor, token) {
    cleanActor(actor);
    check(
      typeof token === "string" && /^w_[a-f0-9]{32}\.[a-f0-9]{48}$/.test(token),
      "This invitation is not valid.",
    );
    const [id, nonce] = token.split(".");
    return transaction(id, () => {
      const data = read(id);
      if (allowed(data, actor)) return { value: view(data, actor) };
      check(
        data.invite &&
          data.invite.expiresAt > now() &&
          data.invite.hash === digest(nonce),
        "This invitation was used or expired. Ask your friend for a new one.",
        403,
        "WORKSHOP_INVITE_EXPIRED",
      );
      check(
        data.members.length < 12,
        "This workshop already has twelve friends.",
        409,
      );
      data.members.push({ id: actor.id, name: actor.name });
      data.invite = null;
      data.revision++;
      return { data, value: view(data, actor) };
    });
  }
  function revoke(actor, id, memberId) {
    cleanActor(actor);
    check(typeof memberId === "string", "Choose a friend.");
    return transaction(id, () => {
      const data = read(id);
      requireAccess(data, actor, true);
      data.members = data.members.filter((m) => m.id !== memberId);
      data.invite = null;
      data.revision++;
      return { data, value: view(data, actor) };
    });
  }
  function visit(actor, id, position, leave = false) {
    cleanActor(actor);
    const data = read(id);
    requireAccess(data, actor);
    const present = visitors.get(id) || new Map();
    if (leave) present.delete(actor.id);
    else {
      check(
        Array.isArray(position) &&
          position.length === 2 &&
          position.every((n) => Number.isInteger(n) && n >= 0 && n < GRID_SIZE),
        "Choose a valid virtual position.",
      );
      present.set(actor.id, {
        id: actor.id,
        name: actor.name,
        x: position[0],
        z: position[1],
        seenAt: now(),
      });
    }
    visitors.set(id, present);
    return view(data, actor);
  }
  return { open, get, edit, invite, join, revoke, visit };
}
