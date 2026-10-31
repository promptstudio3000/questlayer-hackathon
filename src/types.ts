export type Point = { lat: number; lng: number };
export type Fix = Point & { accuracy: number; timestamp: number };
export type Item = {
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
  coinsCollected?: number;
  appearance: { originTokenId?: string };
  id: string;
  name: string;
  gold_u: number;
  xp: number;
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
  geometry?: { type: "Polygon"; coordinates: number[][][] };
  sector?: string;
  shapeFamily?: string;
  kind: string;
  opensAt: number;
  closesAt: number;
  color: string;
};
export type Coin = Point & {
  id: string;
  value_u: number;
  claimant: string | null;
};
export type Quest = Point & {
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
  itemAvailable?: boolean;
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
  cityZoneCount?: number;
  quality?: { notice: string; fieldReview: string };
  endsAt: number;
  zones: Zone[];
  coins: Coin[];
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
