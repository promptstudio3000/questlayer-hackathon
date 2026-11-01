import type { Point, Zone, QuestActivity } from "./types";
import type { NearNetwork } from "./near-network.ts";
export type NativeQuest = {
  activity?: QuestActivity;
  prizeClaimed: boolean;
  prizePending: boolean;
  index: number;
  name: string;
  title: string;
  prompt: string;
  targets: Point[];
  tier: number;
  reward: string;
  xp: number;
  opensAt: number;
  closesAt: number;
  checkpoint: number;
};
export type NativeReceipt = {
  id: string;
  dayId: string;
  accountId: string;
  kind: string;
  index: number;
  state: string;
  amount: string | null;
  xp: number | null;
  transaction: string | null;
  createdAt: number;
  error: string | null;
};
export type NativeGameState = {
  status: string;
  network: NearNetwork;
  accountId: string | null;
  generatedAt: number;
  collection: {
    available: boolean;
    paused: boolean;
    coinLimit: number;
    coinsAcceptedToday: number;
    pendingCoinsToday: number;
    minimumIntervalMs: number;
  };
  contractId: string;
  enrolled: boolean;
  access: { tier: number; weighted: string };
  balance: {
    credit: string;
    pending: string;
    withdrawn: string;
    xp: number;
  } | null;
  day: {
    id: string;
    hash: string;
    day: string;
    endsAt: number;
    startsAt: number;
    map?: { status: string; zones: (Zone & { questIndex: number })[] };
    coinUnit: string;
    coinCount: number;
    claimsAccepted: number;
    claimsLimit: number;
    coins: (Point & { index: number; distance: number })[];
    quests: NativeQuest[];
    /** "realized_yield": paid from staking yield already in the treasury. */
    funding?: "sponsor" | "realized_yield";
    fundingEvidence?: {
      vaults: { accountId: string; gamePaid: string }[];
      paid: string;
      committedBefore: string;
    };
  } | null;
  receipts: NativeReceipt[];
  treasury: {
    coins: { available: string; reserved: string };
    zones: { available: string; reserved: string };
  };
  worker: { queued: number; last_error: string | null };
  vaults: {
    accountId: string;
    beneficiary: string;
    observation?: {
      last_state: string | null;
      last_error: string | null;
    } | null;
  }[];
};
