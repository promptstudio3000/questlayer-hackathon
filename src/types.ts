import type { NearNetwork } from "./near-network.ts";
export type Point = { lat: number; lng: number };
export type Fix = Point & { accuracy: number; timestamp: number };
export type Item = {
  native_claim_id?: string | null;
  native_claim_receiver?: string | null;
  native_claim_state?: "issued" | "minted" | null;
  native_claim_expires_at?: number | null;
  native_token_id?: string | null;
  native_claim_tx?: string | null;
  id: string;
  kind: string;
  name: string;
  rarity: string;
  slot: string;
  color: string;
  equipped: number;
  serial: number | null;
};
export type Position = {
  id: string;
  pool: string;
  active_u: number;
  contribution: number;
  matures_at: number;
  accrued_u: number;
};
export type Withdrawal = {
  id: string;
  amount_u: number;
  ready_at: number;
  state: string;
};
export type Player = {
  nativeOutfit?: boolean;
  nativeAccount?: string | null;
  coinsCollected?: number;
  /** look: changes with the gotchi outfit (art URLs carry it). */
  appearance: { originTokenId?: string; look?: string };
  /** Aavegotchi wearable clones the player wears. */
  wearables?: WornWearable[];
  id: string;
  name: string;
  gold_u: number;
  xp: number;
  earnedXp?: number;
  lockedXp?: number;
  availableXp?: number;
  level: number;
  tier: number;
  weighted_u: number;
  inventory: Item[];
  positions: Position[];
  withdrawals: Withdrawal[];
  history: {
    id: string;
    kind: string;
    title: string;
    gold_u: number;
    created_at: number;
    chain?: import("./chain-proof").ChainRef;
  }[];
  wallets: { account_id: string }[];
};
export type Zone = {
  id: string;
  name: string;
  tier: number;
  lat: number;
  lng: number;
  radius: number;
  geometry?:
    | { type: "Polygon"; coordinates: number[][][] }
    // POI category hunts (W6): one small circle per stop.
    | { type: "MultiPolygon"; coordinates: number[][][][] };
  /** "poi" for a street-cell POI quest place (W6). */
  source?: string;
  sector?: string;
  shapeFamily?: string;
  kind: string;
  opensAt: number;
  closesAt: number;
  color: string;
  placeStatus?: "open" | "closed";
  /** Set while an operator has paused this zone or the whole day. */
  operatorPause?: { reason: string };
};
export type Coin = Point & {
  id: string;
  value_u: number;
  claimant: string | null;
  // A street find is a coin seed that also pays extra XP (server-chosen).
  find?: boolean;
  /** Map rewards: medium or rare coins (small is the default). */
  tier?: "medium" | "rare";
  /** A wearable find: picking it up gives this Aavegotchi wearable clone. */
  wearable?: { id: number; name: string; rarity: WearableRarity };
};
export type WearableRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "legendary"
  | "mythical"
  | "godlike";
/** An Aavegotchi wearable as worn on a character (server/gotchi-wearables.mjs). */
export type WornWearable = {
  id: number;
  slot: string;
  /** x, y, width, height on the 64×64 Aavegotchi canvas. */
  dims: [number, number, number, number];
  verified: boolean;
  name?: string;
  rarity?: WearableRarity;
};
export type QuestActivity = {
  templateId: string;
  version: number;
  icon: "visit" | "trail" | "return" | "chest";
  objective: string;
  actionLabel: string;
  steps: { index: number; label: string; point: Point }[];
  evidence: {
    kind: string;
    attests: string;
    doesNotAttest: string;
    observationRequired: boolean;
  };
  safety: { instruction: string; fieldReview: string };
  distanceLowerBoundM: number;
  durationMinutes: null;
  rewardConstraint?: string;
};
/** Landmark clue (server/landmark-clue.mjs): answers come from Wikidata. */
export type QuestClue = {
  question: string;
  options: { id: string; text: string }[];
  source: string;
  policy: string;
  xp: { correct: number; miss: number };
  result?: { choice: string; correct: boolean; answer: string };
};
export type Quest = Point & {
  author?: { id: string; name: string };
  activity?: QuestActivity;
  nearPrize?: {amountYocto:string;amountNear:string;available:boolean;settlementAsset:'QGOLD';manifestHash:string};
  clue?: QuestClue;
  id: string;
  title: string;
  description: string;
  tier: number;
  gold_u: number;
  xp: number;
  kind: string;
  completed: number;
  zone_id?: string;
  checkpoint?: number;
  checkpointCount?: number;
  nextPoint?: Point | null;
  /** Stops still ahead on a multi-stop walk (next one first for ordered walks). */
  stops?: Point[];
  /** Hunts (any order): stops already visited. */
  visitedStops?: number[];
  itemAvailable?: boolean;
  placeStatus?: "open" | "closed";
  opens_at: number;
  closes_at: number;
  claimant: string | null;
};
export type World = {
  id: string;
  day: string;
  region: string;
  timezone: string;
  arena: boolean;
  source: string;
  center: Point;
  cityName?: string;
  /** Set for city worlds (reviewed or auto); street cells have none. */
  cityId?: string | null;
  /** "auto": an auto city built from unreviewed map data (never funded). */
  cityStatus?: "reviewed" | "auto";
  cityZoneCount?: number;
  coinRadius?: number;
  streetFindXp?: number;
  globalPreparation?: {
    policy: string;
    day: string;
    inputHash: string;
    systemZones: number;
    financialActivation: boolean;
    rewardManifestHash?: string;
    rewardBudgetYocto?: string;
  };
  quality?: {
    notice: string;
    fieldReview: string;
    status?: "auto";
    funded?: boolean;
  };
  /** Street cells: today's POI quests (W6). "empty" = nothing here yet. */
  poiQuests?: {
    status: "ready" | "empty";
    count: number;
    notice?: string;
    /** City worlds: POI quest count per H3 cell searched today. */
    cells?: Record<string, number>;
  };
  endsAt: number;
  zones: Zone[];
  coins: Coin[];
  /** Set when the server sent only the coins within radiusM of this point. */
  coinsNear?: Point & { radiusM: number };
  /** Map rewards (docs/MAP-REWARDS.md): today's cell drops and the next coin wave. */
  mapRewards?: {
    policy: string;
    cells: Record<string, { coins: number; valueU: number; pioneer: boolean; zones: number; waves: number[] }>;
    nextWaveAt: number | null;
    hiddenCoins: number;
  };
  quests: Quest[];
};
export type Listing = {
  id: string;
  item_id: string;
  seller: string;
  seller_name: string;
  price_u: number;
  name: string;
  rarity: string;
  color: string;
  slot: string;
  serial: number;
};
export type Message = Point & {
  id: string;
  text: string;
  author: string;
  image: string | null;
  created_at: number;
  author_fix: string | null;
};
export type Dashboard = {
  buckets: {
    bucket: string;
    available_u: number;
    reserved_u: number;
    paid_u: number;
  }[];
  stakers: number;
  staked: number;
  contributing: number;
  players: number;
  coinsCollected: number;
  worlds: number;
  apr: number;
  mode: string;
  events: {
    id: string;
    kind: string;
    coins_u: number;
    zones_u: number;
    created_at: number;
  }[];
};
export type Bounty = Point & {
  id: string;
  creator: string;
  creator_name: string;
  title: string;
  description: string;
  amount_u: number;
  deadline: number;
  state: string;
};

export type NativeItem = {
  tokenId: string;
  ownerId: string;
  kind: "avatar" | "aura";
  edition: string | null;
  title: string;
  media: string | null;
  color: string;
  rarity: string;
  serial: number | null;
};
export type NativePublicProfile = {
  name: string;
  mutationId: string;
  updatedAt: string | null;
  avatar: { contractId: string; tokenId: string } | null;
};
export type NativeProfileState = {
  network: NearNetwork;
  contractId: string;
  accountId: string;
  status: "unpublished" | "published" | "unsupported";
  profile: NativePublicProfile | null;
  avatarVerified: boolean;
  publishAvatar: { contractId: string; tokenId: string } | null;
  storage: { total: string; available: string } | null;
  minimumStorage: string;
  deposit: string;
  publishEnabled: boolean;
};
export type NativeProfileQuote = {
  network: NearNetwork;
  receiverId: string;
  accountId: string;
  methodName: "set";
  gas: string;
  deposit: string;
  profile: {
    mutation_id: string;
    name: string;
    schema: string;
    avatar_contract: string;
    avatar_token_id: string;
    updated_at: string;
  };
  args: { data: Record<string, unknown> };
};
export type NativeAccount = {
  accountId: string;
  items: NativeItem[];
  equipment: { above: string | null; below: string | null };
  starterMinted: boolean;
  starterOwned: boolean;
  supply: string;
  truncated: boolean;
};
export type NativeWardrobeState = {
  claimsEnabled?: boolean;
  status: string;
  network: NearNetwork;
  contractId: string;
  accounts: NativeAccount[];
};
export type NativeCollectionState = {
  outfits?: NativeAccount[];
  status: string;
  network: NearNetwork;
  contractId: string;
  name: string;
  version: number;
  supply: string;
  items: NativeItem[];
  truncated: boolean;
};

export type NativeAuraClaim = {
  state: "issued" | "minted";
  claim_id: string;
  receiver_id: string;
  edition: string;
  expires_at: number;
  signature: string;
  contractId: string;
  token_id?: string;
};

export type NativeMarketOffer = {
  id: number;
  token_id: string;
  seller: string;
  price: string;
  state: "active" | "buying" | "returning" | "deposited" | "filling";
  buyer: string | null;
  available: boolean;
  token: NativeItem | null;
};
export type NativeMarketState = {
  status: string;
  network: NearNetwork;
  marketContract: string;
  nftContract: string;
  stats: {
    version?: number;
    paused: boolean;
    listing_count: number;
    funded: string;
    escrow: string;
    credits: string;
    withdrawing: string;
    withdrawn: string;
  };
  listings: NativeMarketOffer[];
  token: NativeItem | null;
  verifiedListing?: NativeMarketOffer | null;
  truncated: boolean;
  fromIndex: number;
};
export type NativeMarketBalance = {
  accountId: string;
  credit: string;
  withdrawing: string;
  listed: number;
  buying: number;
};
export type NativeTradeRequest = {
  kind: "list" | "buy" | "cancel" | "withdraw";
  accountId: string;
  marketId: string;
  nftContractId: string;
  tokenId?: string;
  listingId?: number;
  price?: string;
};

export type NearbyExplorer = Point & {
  id: string;
  name: string;
  /** A seeded test-world explorer (labelled demo-bot). */
  demoBot?: boolean;
  color: string;
  appearance?: {
    color: string;
    above: string | null;
    below: string | null;
    skinTokenId: string | null;
    /** Changes with the gotchi outfit, so the art URL skips a stale cache. */
    skinVersion?: string;
    source: "demo" | "native" | "unavailable";
    /** GOLD cosmetics: a marker frame and a live emote (server/gold-spend). */
    gold?: { frame?: string; emote?: string; emoteUntil?: number };
    wearables?: WornWearable[];
  };
};
