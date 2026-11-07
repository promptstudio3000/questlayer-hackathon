import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  statSync,
  realpathSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { canonical, requireValue, sha256 } from "./canonical.mjs";

export const MAX_INPUT_BYTES = 64 * 1024 * 1024;

export function readBounded(file) {
  requireValue(
    statSync(file).isFile() && statSync(file).size <= MAX_INPUT_BYTES,
    "Input exceeds the 64 MiB per-file bound.",
  );
  return readFileSync(file);
}

export function inputFile(root, file) {
  const base = realpathSync(root),
    target = realpathSync(resolve(base, file));
  const rel = relative(base, target);
  requireValue(
    rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`),
    "Input must stay within the supplied snapshot directory (including symlinks).",
  );
  return target;
}

export function immutableFile(file, bytes) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  if (existsSync(file)) {
    requireValue(
      sha256(readFileSync(file)) === sha256(bytes),
      "Immutable preparation output differs or is corrupt.",
    );
    return;
  }
  // The preparation directory is exclusively locked. Rename avoids exposing a
  // partial immutable object if the process dies in the middle of a write.
  atomicFile(file, bytes);
}

export function atomicFile(file, bytes) {
  const temporary = `${file}.tmp-${randomUUID()}`;
  let fd;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, file);
    const dir = openSync(dirname(file), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

// Single-host process exclusion. A dead process can be resumed; a live process
// or a directory owned by another host cannot be stolen on a time-based lease.
export function lockDirectory(root) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = resolve(root, ".prepare.lock"),
    token = randomUUID();
  try {
    writeFileSync(
      file,
      canonical({ host: hostname(), pid: process.pid, token }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const old = JSON.parse(readBounded(file));
    requireValue(
      old.host === hostname() && Number.isSafeInteger(old.pid) && old.pid > 0,
      "Preparation is locked on another host or has an invalid lock.",
    );
    let dead = false;
    try {
      process.kill(old.pid, 0);
    } catch (e) {
      dead = e.code === "ESRCH";
    }
    requireValue(dead, "Preparation is already running.");
    // Do not race two recoverers: rename is not compare-and-swap. An exclusive
    // recovery file serializes stale-lock removal as well as reacquisition.
    const recovery = `${file}.recovery`;
    const fd = openSync(recovery, "wx", 0o600);
    try {
      requireValue(
        readFileSync(file, "utf8") === canonical(old),
        "Preparation lock changed; retry.",
      );
      unlinkSync(file);
      writeFileSync(
        file,
        canonical({ host: hostname(), pid: process.pid, token }),
        { flag: "wx", mode: 0o600 },
      );
    } finally {
      closeSync(fd);
      unlinkSync(recovery);
    }
  }
  return () => {
    if (JSON.parse(readFileSync(file, "utf8")).token === token)
      unlinkSync(file);
  };
}
