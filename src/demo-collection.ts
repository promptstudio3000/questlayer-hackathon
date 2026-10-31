export type DemoCollectionContext = {
  playerId?: string;
  worldId?: string;
  arena: boolean;
  worldArena?: boolean;
  endsAt?: number;
  nativePlay: boolean;
  loading: boolean;
  visible: boolean;
  online: boolean;
};
/** Client request fence only; the server still validates presence and the award. */
export function canContinueDemoCollection(
  expected: DemoCollectionContext,
  current: DemoCollectionContext,
  now: number,
) {
  return (
    !!current.playerId &&
    !!current.worldId &&
    expected.playerId === current.playerId &&
    expected.worldId === current.worldId &&
    expected.arena === current.arena &&
    current.worldArena === current.arena &&
    current.nativePlay === false &&
    current.loading === false &&
    current.visible === true &&
    current.online === true &&
    Number.isFinite(now) &&
    Number.isFinite(current.endsAt) &&
    current.endsAt! > now
  );
}
