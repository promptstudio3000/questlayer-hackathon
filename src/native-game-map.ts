import type { NativeGameState } from "./native-game-types";
import type { World, Point } from "./types";
export function nativeWorldView(
  state: NativeGameState | null,
  center: Point,
): World {
  const day = state?.day;
  return {
    id: day?.id || "native-loading",
    day: day?.day || "",
    region: "plzen",
    timezone: "Europe/Prague",
    arena: false,
    source: "Confirmed NEAR testnet manifest",
    center,
    cityName: "Plzeň · NEAR testnet",
    cityZoneCount: day?.quests.length || 0,
    endsAt: day?.endsAt || 0,
    zones: day?.map?.status === "verified" ? day.map.zones : [],
    coins: (day?.coins || []).map((c) => ({
      ...c,
      id: `native-coin:${c.index}`,
      claimant: null,
      value_u: 0,
    })),
    quests: (day?.quests || []).map((q) => ({
      ...q.targets[0],
      id: `native-quest:${q.index}`,
      zone_id: `${day!.id}:zone:${q.index}`,
      title: q.title,
      description: q.activity?.objective || q.prompt,
      tier: q.tier,
      gold_u: 0,
      xp: q.xp,
      kind: "route",
      completed: Number(q.checkpoint >= q.targets.length),
      checkpoint: q.checkpoint,
      checkpointCount: q.targets.length,
      nextPoint: q.targets[Math.min(q.checkpoint, q.targets.length - 1)],
      opens_at: q.opensAt,
      closes_at: q.closesAt,
      claimant: q.prizeClaimed ? "claimed" : null,
    })),
  };
}
