// Public note records on NEAR Social (plan slice 6). A note that is already
// public in the app can be kept as a permanent record under the player's own
// SocialDB namespace. The managed account signs through the relayer (no
// popup); an external wallet is the fallback. The quote is checked field by
// field before anything is signed.
import { NEAR_NETWORK, SOCIAL_CONTRACT_ID } from "./near-network.ts";
import type { NativeSigner } from "./native-signer";

export type NoteRecordKind = "note" | "tombstone";
export type PublicNoteRecord = {
  schema: string;
  note_id: string;
  state: "published" | "removed";
  text: string;
  lat: string;
  lng: string;
  anchor: string;
  author_fix: string;
  image: string;
  image_sha256: string;
  created_at: string;
  updated_at: string;
  mutation_id: string;
};
export type NoteRecordStatus = {
  network: string;
  contractId: string;
  accountId: string;
  noteId: string;
  localState: string;
  chain: PublicNoteRecord | null;
  media: {
    cid: string;
    sha256: string;
    state: "computed" | "pinning" | "pinned" | "mismatch" | "unavailable";
    pinnedAt: number | null;
  } | null;
  publications: {
    mutation_id: string;
    kind: NoteRecordKind;
    state: "prepared" | "confirmed";
    prepared_at: number;
    confirmed_at: number | null;
  }[];
  permanence: string;
};
export type NoteRecordQuote = {
  network: string;
  receiverId: string;
  accountId: string;
  methodName: "set";
  gas: string;
  deposit: string;
  kind: NoteRecordKind;
  record: PublicNoteRecord;
  args: { data: Record<string, unknown> };
  permanence: string;
};
// What the author sees: one of these states, never a raw chain dump.
export type NoteRecordView =
  "none" | "pending" | "published" | "outdated" | "removed";

const FIELDS = [
  "schema",
  "note_id",
  "state",
  "text",
  "lat",
  "lng",
  "anchor",
  "author_fix",
  "image",
  "image_sha256",
  "created_at",
  "updated_at",
  "mutation_id",
];
const NOTE_ID = /^message_[a-f0-9-]{36}$/;
const MUTATION_ID = /^record_[a-f0-9-]{36}$/;
export const RECORD_DEPOSITS = ["1", "50000000000000000000000"];
const keys = (value: unknown, expected: string[]) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === expected.slice().sort().join("|");

export function recordView(
  status: Pick<NoteRecordStatus, "chain" | "publications"> | null,
  noteText?: string,
): NoteRecordView {
  if (!status) return "none";
  const chain = status.chain;
  if (chain?.state === "removed") return "removed";
  if (chain)
    return noteText !== undefined && chain.text !== noteText
      ? "outdated"
      : "published";
  return status.publications.some((p) => p.state === "prepared")
    ? "pending"
    : "none";
}

export function assertRecordQuote(
  quote: NoteRecordQuote,
  expected: { accountId: string; noteId: string; kind: NoteRecordKind },
) {
  const fail = (): never => {
    throw Error("This record changed while it was prepared. Try again.");
  };
  if (
    !quote ||
    quote.network !== NEAR_NETWORK ||
    quote.receiverId !== SOCIAL_CONTRACT_ID ||
    quote.accountId !== expected.accountId ||
    quote.methodName !== "set" ||
    quote.kind !== expected.kind ||
    !RECORD_DEPOSITS.includes(quote.deposit) ||
    !/^\d+$/.test(quote.gas) ||
    BigInt(quote.gas) > 100_000_000_000_000n ||
    !NOTE_ID.test(expected.noteId) ||
    !keys(quote.args, ["data"]) ||
    !keys(quote.args.data, [expected.accountId])
  )
    fail();
  const root = quote.args.data[expected.accountId] as Record<string, unknown>;
  if (!keys(root, ["questlayer"])) fail();
  const layer = root.questlayer as Record<string, unknown>;
  if (!keys(layer, ["notes"])) fail();
  const notes = layer.notes as Record<string, unknown>;
  if (!keys(notes, [expected.noteId])) fail();
  const actual = notes[expected.noteId] as Record<string, unknown>,
    reviewed = quote.record as unknown as Record<string, unknown>;
  if (
    !keys(actual, FIELDS) ||
    !keys(reviewed, FIELDS) ||
    FIELDS.some(
      (f) => typeof actual[f] !== "string" || actual[f] !== reviewed[f],
    ) ||
    actual.schema !== "1" ||
    actual.note_id !== expected.noteId ||
    actual.state !== (expected.kind === "note" ? "published" : "removed") ||
    !MUTATION_ID.test(String(actual.mutation_id))
  )
    fail();
  if (
    expected.kind === "tombstone" &&
    ["text", "lat", "lng", "author_fix", "image", "image_sha256"].some(
      (f) => actual[f] !== "",
    )
  )
    fail();
}

type Call = <T>(path: string, body?: unknown) => Promise<T>;
export async function publishNoteRecord({
  call,
  signer,
  accountId,
  playerId,
  noteId,
  kind,
  attempts = 6,
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
}: {
  call: Call;
  signer: NativeSigner;
  accountId: string;
  playerId: string;
  noteId: string;
  kind: NoteRecordKind;
  attempts?: number;
  wait?: (ms: number) => Promise<unknown>;
}): Promise<{ confirmed: boolean; mutationId: string }> {
  const quote = await call<NoteRecordQuote>("/native/records/prepare", {
    accountId,
    noteId,
    kind,
    publicConsent: true,
    permanenceAcknowledged: true,
  });
  assertRecordQuote(quote, { accountId, noteId, kind });
  await signer.send(
    {
      network: NEAR_NETWORK,
      signerId: accountId,
      receiverId: SOCIAL_CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "set",
            args: quote.args,
            gas: quote.gas,
            deposit: quote.deposit,
          },
        },
      ],
    },
    { playerId },
  );
  const mutationId = quote.record.mutation_id;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await call<{ confirmed: boolean }>(
      "/native/records/confirm",
      { accountId, noteId, mutationId },
    );
    if (result.confirmed) return { confirmed: true, mutationId };
    await wait(900);
  }
  return { confirmed: false, mutationId };
}
