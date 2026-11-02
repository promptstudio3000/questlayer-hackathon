import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  BookmarkSimple,
  Check,
  Eye,
  EyeSlash,
  PencilSimple,
  Plus,
  UserCircle,
  UsersThree,
  Flag,
  ShieldSlash,
} from "@phosphor-icons/react";
import { Ghost } from "./Ghost";
import {
  CreatorEarningsPanel,
  CreatorSupport,
  type CreatorMoneyBridge,
} from "./CreatorMoney";
import { meters } from "./api";
import { parseAccessPrice, nearText } from "./creator-money-quote";
import { formatNativeNear } from "./native-amounts";
import { Dialog } from "./Dialog";
import { useFormDraft } from "./useFormDraft";
import { AiQuestDraft } from "./AiQuestDraft";
import {
  createCreatorClient,
  creatorDraftIdentity,
  CreatorClientError,
  type CreatorClient,
} from "./creator-community-client";
import {
  parseCreatorCommunityView,
  parseCreatorCapability,
  creatorReportTarget,
  type CreatorReportTarget,
  type CreatorCompletionState,
  type CreatorReportReason,
  type BlockedCreator,
  type CreatorCapability,
  type CreatorCommunityView,
  type CreatorMe,
  type CreatorPage,
  type CreatorParticipation,
  type CreatorPlace,
  type CreatorPlaceTemplate,
  type CreatorProfile,
  type CreatorPublicationQuote,
  type OwnedCreatorQuest,
  type PublicCreatorQuest,
} from "./creator-community-types";
import type { Player } from "./types";
import "./creator-community.css";

export type { CreatorCommunityView } from "./creator-community-types";
type Props = {
  player: Player;
  notify?: (message: string, error?: boolean) => void;
  view?: CreatorCommunityView;
  onViewChange?: (view: CreatorCommunityView) => void;
  onPlayerChange?: () => void | Promise<void>;
  onCapabilityChange?: (enabled: boolean) => void;
  client?: CreatorClient;
  /** Where the explorer stands now, for "Near you". Never sent to the server. */
  position?: { lat: number; lng: number };
  money?: CreatorMoneyBridge;
  /**
   * Community screen tab hosting this component. "quests" shows quest browsing
   * and started quests; "creators" shows creators and your own creations.
   * Omitted, every section is reachable from the inner navigation.
   */
  section?: "quests" | "creators";
};
type Point = { lat: number; lng: number };
type Loaded = {
  me: CreatorMe;
  quests?: CreatorPage<PublicCreatorQuest>;
  following?: CreatorPage<PublicCreatorQuest>;
  creators?: CreatorPage<CreatorProfile>;
  mine?: CreatorPage<OwnedCreatorQuest>;
  participations?: CreatorPage<CreatorParticipation>;
  blocks?: CreatorPage<BlockedCreator>;
  quest?: PublicCreatorQuest | null;
  participation?: CreatorParticipation | null;
  creator?: CreatorProfile & { following: boolean };
  owned?: OwnedCreatorQuest;
  completion?: CreatorCompletionState;
};
type Action = (
  path: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
  message: string,
  confirmed?: (stillHere: boolean) => void,
  failed?: (error: Error) => void,
) => Promise<boolean>;
type SafetyAction =
  | { kind: "report"; target: CreatorReportTarget }
  | {
      kind: "block";
      creator: BlockedCreator;
      blocked: boolean;
      keepStartedQuest?: string;
    };
const PROFILE_FIELDS = { displayName: 80, bio: 1000 };
const QUEST_FIELDS = { title: 100, description: 4000 };
const count = (n: number) => new Intl.NumberFormat("en-US").format(n);
const idPath = (value: string) => encodeURIComponent(value);
const statusName = (state: string) =>
  ({
    pending_review: "In review",
    published: "Published",
    draft: "Draft",
    rejected: "Review rejected",
    closing: "Closing",
    closed: "Closed",
    withdrawn: "Review withdrawn",
    approved: "Approved",
    open: "In progress",
    resolved: "Review complete",
  })[state] || state;

export const PLACE_TEMPLATES: Record<
  CreatorPlaceTemplate,
  { name: string; badge: string; hint: string; max: number; min: number }
> = {
  visit: {
    name: "Visit a place",
    badge: "Visit",
    hint: "Pin one spot. Explorers go there and tell what they found.",
    min: 1,
    max: 1,
  },
  trail: {
    name: "Walk a trail",
    badge: "Trail",
    hint: "Pin 2 to 6 stops in walking order, under 5 km in total.",
    min: 2,
    max: 6,
  },
  chest: {
    name: "Hide a chest",
    badge: "Chest",
    hint: "Pin where your chest waits. Explorers open it on the spot.",
    min: 1,
    max: 1,
  },
};
const NEARBY_METERS = 5000;
export const distanceText = (m: number) =>
  m < 950
    ? `${Math.max(10, Math.round(m / 10) * 10)} m`
    : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`;
const placeDistance = (place: CreatorPlace | undefined, from?: Point) =>
  place && from && place.points[0] ? meters(from, place.points[0]) : null;
function trailLength(points: Point[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += meters(points[i - 1], points[i]);
  return total;
}
/** Quests with a pinned place within 5 km, nearest first. */
export function nearbyQuests(
  quests: PublicCreatorQuest[],
  from?: Point,
): Array<{ quest: PublicCreatorQuest; distance: number }> {
  if (!from) return [];
  return quests
    .map((quest) => ({ quest, distance: placeDistance(quest.place, from) }))
    .filter(
      (x): x is { quest: PublicCreatorQuest; distance: number } =>
        x.distance !== null && x.distance <= NEARBY_METERS,
    )
    .sort((a, b) => a.distance - b.distance);
}

async function maybeRead<T>(
  client: CreatorClient,
  path: string,
  signal: AbortSignal,
): Promise<T | null> {
  try {
    return await client.read<T>(path, signal);
  } catch (error) {
    if (error instanceof CreatorClientError && error.status === 404)
      return null;
    throw error;
  }
}
async function load(
  client: CreatorClient,
  view: CreatorCommunityView,
  signal: AbortSignal,
): Promise<Loaded> {
  const me = await client.read<CreatorMe>("/me", signal);
  if (me.domain !== "demo" || me.profile.id !== client.playerId)
    throw new CreatorClientError(
      "The current creator session could not be verified. Refresh before continuing.",
    );
  switch (view.page) {
    case "community": {
      const [quests, following] = await Promise.all([
        client.read<CreatorPage<PublicCreatorQuest>>(
          "/quests?limit=50",
          signal,
        ),
        client.read<CreatorPage<PublicCreatorQuest>>(
          "/quests?following=true&limit=5",
          signal,
        ),
      ]);
      return { me, quests, following };
    }
    case "following":
      return {
        me,
        quests: await client.read("/quests?following=true&limit=20", signal),
      };
    case "creators":
      return { me, creators: await client.read("/creators?limit=20", signal) };
    case "mine":
      return { me, mine: await client.read("/me/quests?limit=20", signal) };
    case "blocked":
      return { me, blocks: await client.read("/me/blocks?limit=20", signal) };
    case "participations":
      return {
        me,
        participations: await client.read(
          "/me/participations?limit=20",
          signal,
        ),
      };
    case "profile":
      return { me };
    case "edit":
      return {
        me,
        ...(view.questId
          ? {
              owned: await client.read<OwnedCreatorQuest>(
                `/me/quests/${idPath(view.questId)}`,
                signal,
              ),
            }
          : {}),
      };
    case "creator": {
      const [creator, quests] = await Promise.all([
        client.read<CreatorProfile & { following: boolean }>(
          `/creators/${idPath(view.creatorId)}`,
          signal,
        ),
        client.read<CreatorPage<PublicCreatorQuest>>(
          `/quests?creator=${idPath(view.creatorId)}&limit=20`,
          signal,
        ),
      ]);
      return { me, creator, quests };
    }
    case "quest": {
      const [quest, participation] = await Promise.all([
        maybeRead<PublicCreatorQuest>(
          client,
          `/quests/${idPath(view.questId)}`,
          signal,
        ),
        maybeRead<CreatorParticipation>(
          client,
          `/quests/${idPath(view.questId)}/participation`,
          signal,
        ),
      ]);
      if (!quest && !participation)
        throw new CreatorClientError(
          "This quest is no longer available to you. Any accepted instructions remain in Your started quests.",
          404,
        );
      if (
        !creatorReportTarget(quest, participation) ||
        (quest && quest.id !== view.questId) ||
        (participation && participation.questId !== view.questId)
      )
        throw new CreatorClientError(
          "The quest revision could not be verified. Refresh before reporting or starting.",
        );
      return {
        me,
        quest,
        participation,
        completion: participation
          ? await client.read<CreatorCompletionState>(
              `/quests/${idPath(view.questId)}/completion`,
              signal,
            )
          : undefined,
      };
    }
  }
}

export function CreatorCommunity(props: Props) {
  return <CreatorCommunitySession key={props.player.id} {...props} />;
}
function CreatorCommunitySession({
  player,
  view: controlled,
  onViewChange,
  onPlayerChange,
  onCapabilityChange,
  client: injected,
  position,
  money,
  section: screenSection,
}: Props) {
  const client = useMemo(
    () => injected || createCreatorClient({ playerId: player.id }),
    [player.id, injected],
  );
  const [localView, setLocalView] = useState<CreatorCommunityView>({
    page: "community",
  });
  const view = parseCreatorCommunityView(controlled || localView) || {
    page: "community",
  };
  const viewKey = JSON.stringify(view);
  const [safety, setSafety] = useState<SafetyAction | null>(null);
  useEffect(() => setSafety(null), [viewKey]);
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    capability: CreatorCapability | null;
    data: Loaded | null;
    loading: boolean;
    error: string;
  }>({ key: "", capability: null, data: null, loading: true, error: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const actionLock = useRef(false),
    alive = useRef(true),
    section = useRef<HTMLElement>(null);
  const shouldFocus = useRef(false),
    lastView = useRef(viewKey);
  const currentView = useRef(viewKey);
  currentView.current = viewKey;
  const capabilityCallback = useRef(onCapabilityChange),
    lastCapability = useRef<boolean | null>(null);
  capabilityCallback.current = onCapabilityChange;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (lastView.current !== viewKey) shouldFocus.current = true;
    lastView.current = viewKey;
    const controller = new AbortController();
    setSnapshot({
      key: viewKey,
      capability: null,
      data: null,
      loading: true,
      error: "",
    });
    void (async () => {
      let capability: CreatorCapability | null = null;
      try {
        capability = parseCreatorCapability(
          await client.read<CreatorCapability>("/status", controller.signal),
        );
        if (!capability)
          throw new CreatorClientError(
            "This creator feature's domain or publication policy could not be verified.",
          );
        if (controller.signal.aborted) return;
        if (lastCapability.current !== capability.enabled) {
          lastCapability.current = capability.enabled;
          capabilityCallback.current?.(capability.enabled);
        }
        const data = capability.enabled
          ? await load(client, view, controller.signal)
          : null;
        if (!controller.signal.aborted) {
          setSnapshot({
            key: viewKey,
            capability,
            data,
            loading: false,
            error: "",
          });
          if (shouldFocus.current)
            requestAnimationFrame(() => {
              section.current
                ?.querySelector<HTMLElement>("[data-creator-heading]")
                ?.focus();
              shouldFocus.current = false;
            });
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !capability &&
          lastCapability.current !== false
        ) {
          lastCapability.current = false;
          capabilityCallback.current?.(false);
        }
        if (!controller.signal.aborted)
          setSnapshot({
            key: viewKey,
            capability,
            data: null,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Creator quests could not be loaded.",
          });
      }
    })();
    return () => controller.abort();
  }, [client, viewKey, refresh]);
  const state =
    snapshot.key === viewKey
      ? snapshot
      : {
          key: viewKey,
          capability: null,
          data: null,
          loading: true,
          error: "",
        };
  function navigate(next: CreatorCommunityView) {
    setLocalView(next);
    onViewChange?.(next);
    setMessage("");
  }
  const act: Action = async (
    path,
    method,
    body,
    success,
    confirmed,
    failed,
  ) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await client.mutate(path, method, body);
      if (!alive.current) return true;
      confirmed?.(currentView.current === viewKey);
      if (currentView.current === viewKey) shouldFocus.current = true;
      setMessage(success);
      setRefresh((n) => n + 1);
      void onPlayerChange?.();
      return true;
    } catch (error) {
      if (alive.current)
        failed?.(
          error instanceof Error
            ? error
            : new Error(
                "The action could not be confirmed. Retry the same terms.",
              ),
        );
      if (alive.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "The action has not been confirmed. Refresh, then retry the same terms.",
        );
      return false;
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  async function more(
    field: "quests" | "creators" | "mine" | "participations" | "blocks",
    path: string,
  ) {
    const page = state.data?.[field];
    if (!page?.nextCursor || actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    const key = viewKey;
    try {
      const next = await client.read<
        CreatorPage<
          | PublicCreatorQuest
          | CreatorProfile
          | OwnedCreatorQuest
          | CreatorParticipation
          | BlockedCreator
        >
      >(
        `${path}${path.includes("?") ? "&" : "?"}cursor=${idPath(page.nextCursor)}&limit=20`,
      );
      if (alive.current && currentView.current === key)
        setSnapshot((old) => {
          if (!old.data || old.key !== key) return old;
          const previous = old.data[field]?.items || [];
          const all = [...previous, ...next.items];
          const identities = new Set<string>();
          const items = all.filter((item) => {
            const id = "id" in item ? item.id : item.questId;
            if (identities.has(id)) return false;
            identities.add(id);
            return true;
          });
          return { ...old, data: { ...old.data, [field]: { ...next, items } } };
        });
    } catch (error) {
      if (alive.current && currentView.current === key)
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load more quests.",
        );
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (!state.capability?.enabled)
    return (
      <details className="creator-feature">
        <summary>
          <UsersThree size={22} /> Creator quests
        </summary>
        <p>
          {state.loading
            ? "Checking creator quests…"
            : state.error ||
              "Creator quests are not enabled on this host yet. Map notes and sponsored tasks remain available in the Notes and Tasks tabs."}
        </p>
        {!state.loading && (
          <button
            className="secondary-button"
            onClick={() => setRefresh((n) => n + 1)}
          >
            Check availability <ArrowClockwise size={20} />
          </button>
        )}
      </details>
    );
  const data = state.data;
  const allTabs = [
    { page: "community", label: "Community", section: "quests" },
    { page: "following", label: "Following", section: "quests" },
    { page: "participations", label: "Started", section: "quests" },
    { page: "creators", label: "Creators", section: "creators" },
    { page: "mine", label: "My creations", section: "creators" },
  ] as const;
  const tabs = allTabs.filter((tab) =>
    screenSection
      ? tab.section === screenSection
      : tab.page !== "participations",
  );
  const active =
    view.page === "edit" || view.page === "profile" || view.page === "blocked"
      ? "mine"
      : view.page === "creator"
        ? "creators"
        : view.page;
  return (
    <section
      ref={section}
      className="creator-community"
      aria-label="Creator community"
      aria-busy={state.loading || busy}
    >
      <div className="creator-heading">
        <div>
          <small className="creator-mode">Demo creator quests · free</small>
          <h2 data-creator-heading tabIndex={-1}>
            Stories from explorers
          </h2>
        </div>
        <button
          className="creator-icon"
          aria-label="Refresh creator quests"
          disabled={busy || state.loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <ArrowClockwise size={22} />
        </button>
      </div>
      <details className="screen-details creator-intro-details">
        <summary>Details</summary>
        <div className="screen-details-body">
          <p className="creator-intro">
            Find a free quest or write one of your own. Creator quest rewards
            are not configured yet.
          </p>
        </div>
      </details>
      <nav className="creator-tabs" aria-label="Creator community section">
        {tabs.map((tab) => (
          <button
            key={tab.page}
            aria-current={active === tab.page ? "page" : undefined}
            onClick={() => navigate({ page: tab.page })}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {!screenSection && (
        <button
          className="creator-started"
          onClick={() => navigate({ page: "participations" })}
        >
          <BookmarkSimple size={20} /> Your started quests{" "}
          <ArrowRight size={20} />
        </button>
      )}
      {message && (
        <p className="creator-message" role="status">
          {message}
        </p>
      )}
      {!client.durable && (
        <p className="creator-hint">
          Browser storage is unavailable. Keep this tab open until an action is
          confirmed.
        </p>
      )}
      {state.loading ? (
        <p role="status">Loading creator quests…</p>
      ) : state.error ? (
        <div className="creator-error" role="alert">
          <p>{state.error}</p>
          <button
            className="secondary-button"
            onClick={() => setRefresh((n) => n + 1)}
          >
            Try again <ArrowClockwise size={20} />
          </button>
          {view.page === "creator" && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void act(
                  `/creators/${idPath(view.creatorId)}/follow`,
                  "PUT",
                  { following: false },
                  "Following preference confirmed.",
                )
              }
            >
              Stop following this creator
            </button>
          )}
        </div>
      ) : (
        data && (
          <>
            {view.page === "community" && (
              <CommunityHome
                data={data}
                position={position}
                navigate={navigate}
              />
            )}
            {(view.page === "community" || view.page === "following") && (
              <>
                <h3>
                  {view.page === "following"
                    ? "From creators you follow"
                    : "All creator quests"}
                </h3>
                <QuestList
                  page={data.quests}
                  from={position}
                  navigate={navigate}
                  empty={
                    view.page === "following"
                      ? "Follow a creator to see their published quests here. Following is free and does not share your location."
                      : "No reviewed creator quests are published yet. Explore the map, or start a draft in My creations."
                  }
                />
                {data.quests?.nextCursor && (
                  <More
                    busy={busy}
                    onClick={() =>
                      void more(
                        "quests",
                        view.page === "following"
                          ? "/quests?following=true"
                          : "/quests",
                      )
                    }
                  />
                )}
              </>
            )}
            {view.page === "creators" && (
              <>
                <h3>Meet the creators</h3>
                {!data.creators?.items.length ? (
                  <Empty>
                    Creators appear here after they deliberately publish a
                    profile.
                  </Empty>
                ) : (
                  data.creators.items.map((creator) => (
                    <article className="creator-row" key={creator.id}>
                      <UserCircle size={32} aria-hidden="true" />
                      <div>
                        <h4>{creator.displayName}</h4>
                        <p>
                          {creator.bio || "Free quests from this explorer."}
                        </p>
                        <button
                          className="text-button"
                          onClick={() =>
                            navigate({ page: "creator", creatorId: creator.id })
                          }
                        >
                          View creator <ArrowRight size={20} />
                        </button>
                      </div>
                    </article>
                  ))
                )}
                {data.creators?.nextCursor && (
                  <More
                    busy={busy}
                    onClick={() => void more("creators", "/creators")}
                  />
                )}
              </>
            )}
            {view.page === "creator" && data.creator && (
              <>
                <Back onClick={() => navigate({ page: "creators" })}>
                  Creators
                </Back>
                <h3>{data.creator.displayName}</h3>
                <p>{data.creator.bio}</p>
                {data.creator.id !== player.id && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        `/creators/${idPath(data.creator!.id)}/follow`,
                        "PUT",
                        { following: !data.creator!.following },
                        "Following preference confirmed.",
                      )
                    }
                  >
                    <UsersThree size={20} />
                    {data.creator.following ? "Unfollow" : "Follow for free"}
                  </button>
                )}
                <p className="creator-hint">
                  Following neither pays the creator nor shares your location.
                </p>
                {data.creator.id !== player.id && (
                  <details className="creator-safety-tools">
                    <summary>Creator safety</summary>
                    <p className="creator-hint">
                      Blocking hides public content between you. Your started
                      quest instructions remain available.
                    </p>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        setSafety({
                          kind: "block",
                          creator: data.creator!,
                          blocked: true,
                        })
                      }
                    >
                      <ShieldSlash size={20} />
                      Block creator…
                    </button>
                  </details>
                )}
                <QuestList
                  page={data.quests}
                  from={position}
                  navigate={navigate}
                  empty="This creator has no published free quests at the moment."
                />
                {data.quests?.nextCursor && (
                  <More
                    busy={busy}
                    onClick={() =>
                      void more(
                        "quests",
                        `/quests?creator=${idPath(view.creatorId)}`,
                      )
                    }
                  />
                )}
              </>
            )}
            {view.page === "participations" && (
              <>
                <h3>Your started quests</h3>
                <p className="creator-hint">
                  Your accepted instructions remain available after edits or
                  closure.
                </p>
                {!data.participations?.items.length ? (
                  <Empty>
                    Start a reviewed free quest to keep its instructions here.
                  </Empty>
                ) : (
                  data.participations.items.map((part) => (
                    <article className="creator-quest-row" key={part.questId}>
                      <button
                        className="creator-quest-open"
                        onClick={() =>
                          navigate({ page: "quest", questId: part.questId })
                        }
                      >
                        <span className="creator-state">
                          {statusName(part.state)}
                        </span>
                        <h4>{part.content.title}</h4>
                        <small>
                          Accepted revision {part.revision} ·{" "}
                          {statusName(part.questState)}
                        </small>
                        <ArrowRight size={22} />
                      </button>
                    </article>
                  ))
                )}
                {data.participations?.nextCursor && (
                  <More
                    busy={busy}
                    onClick={() =>
                      void more("participations", "/me/participations")
                    }
                  />
                )}
              </>
            )}
            {view.page === "quest" && (
              <QuestDetail
                playerId={player.id}
                data={data}
                busy={busy}
                act={act}
                navigate={navigate}
                onSafety={setSafety}
                money={money}
                position={position}
              />
            )}
            {view.page === "mine" && (
              <>
                <div className="creator-heading">
                  <h3>My creations</h3>
                  <button
                    className="primary-button"
                    onClick={() => navigate({ page: "edit", questId: null })}
                  >
                    <Plus size={20} /> New quest
                  </button>
                </div>
                {money && <CreatorEarningsPanel money={money} />}
                <Progression me={data.me} />
                <button
                  className="creator-profile-entry"
                  onClick={() => navigate({ page: "profile" })}
                >
                  {data.me.profile.public ? (
                    <Eye size={22} />
                  ) : (
                    <EyeSlash size={22} />
                  )}
                  <span>
                    <strong>
                      {data.me.profile.displayName ||
                        "Set up your creator profile"}
                    </strong>
                    <small>
                      {data.me.profile.public
                        ? "Public profile"
                        : "Profile is private"}
                    </small>
                  </span>
                  <ArrowRight size={22} />
                </button>
                <button
                  className="text-button"
                  onClick={() => navigate({ page: "blocked" })}
                >
                  <ShieldSlash size={20} />
                  Blocked creators
                  <ArrowRight size={20} />
                </button>
                {!data.mine?.items.length ? (
                  <Empty>
                    Write a title and clear instructions. Drafts do not lock XP
                    or become public.
                  </Empty>
                ) : (
                  data.mine.items.map((quest) => (
                    <article className="creator-quest-row" key={quest.id}>
                      <button
                        className="creator-quest-open"
                        onClick={() =>
                          navigate({ page: "edit", questId: quest.id })
                        }
                      >
                        <span className="creator-state">
                          {statusName(quest.state)}
                        </span>
                        <h4>{quest.draft.title}</h4>
                        <small>
                          Revision {quest.latestRevision} ·{" "}
                          {quest.lockedXp
                            ? `${count(quest.lockedXp)} XP committed`
                            : "No XP committed"}
                          {quest.openParticipations
                            ? ` · ${quest.openParticipations} in progress`
                            : ""}
                        </small>
                        <ArrowRight size={22} />
                      </button>
                    </article>
                  ))
                )}
                {data.mine?.nextCursor && (
                  <More
                    busy={busy}
                    onClick={() => void more("mine", "/me/quests")}
                  />
                )}
              </>
            )}
            {view.page === "profile" && (
              <ProfileEditor
                me={data.me}
                playerId={player.id}
                busy={busy}
                act={act}
                navigate={navigate}
              />
            )}
            {view.page === "blocked" && (
              <>
                <Back onClick={() => navigate({ page: "mine" })}>
                  My creations
                </Back>
                <h3>Blocked creators</h3>
                <p className="creator-hint">
                  This private list includes shared player blocks you set,
                  including explorers without a public creator profile. Blocks
                  also affect public notes, profiles, follows and presence in
                  both directions. They do not erase your accepted quest
                  instructions or resolve participant obligations.
                </p>
                {!data.blocks?.items.length ? (
                  <Empty>You have not blocked any creators.</Empty>
                ) : (
                  data.blocks.items.map((creator) => (
                    <article className="creator-row" key={creator.id}>
                      <ShieldSlash size={28} />
                      <div>
                        <h4>{creator.displayName || "Blocked explorer"}</h4>
                        {!creator.displayName && (
                          <small>Creator ID: {creator.id}</small>
                        )}
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() =>
                            setSafety({
                              kind: "block",
                              creator,
                              blocked: false,
                            })
                          }
                        >
                          Review unblock…
                        </button>
                      </div>
                    </article>
                  ))
                )}
                {data.blocks?.nextCursor && (
                  <More
                    busy={busy}
                    onClick={() => void more("blocks", "/me/blocks")}
                  />
                )}
              </>
            )}
            {view.page === "edit" && (
              <QuestEditor
                key={view.questId || "new"}
                playerId={player.id}
                quest={data.owned}
                me={data.me}
                capability={state.capability}
                client={client}
                position={position}
                busy={busy}
                act={act}
                navigate={navigate}
              />
            )}
          </>
        )
      )}
      {safety && (
        <CreatorSafetyDialog
          key={
            safety.kind === "report"
              ? `report:${safety.target.questId}:${safety.target.revision}`
              : `block:${safety.creator.id}:${safety.blocked}`
          }
          action={safety}
          playerId={player.id}
          busy={busy}
          act={act}
          onClose={() => setSafety(null)}
          onConfirmed={(stillHere) => {
            if (stillHere) shouldFocus.current = true;
            setSafety((current) => (current === safety ? null : current));
            if (stillHere && safety.kind === "block")
              navigate(
                safety.keepStartedQuest
                  ? { page: "quest", questId: safety.keepStartedQuest }
                  : { page: "blocked" },
              );
          }}
        />
      )}
    </section>
  );
}

function Back({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className="creator-back" onClick={onClick}>
      <ArrowLeft size={20} />
      {children}
    </button>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="creator-empty">
      <Ghost />
      <p>{children}</p>
    </div>
  );
}
function More({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      className="secondary-button creator-more"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? "Loading…" : "Load more"}
      <ArrowRight size={20} />
    </button>
  );
}
function CommunityHome({
  data,
  position,
  navigate,
}: {
  data: Loaded;
  position?: Point;
  navigate: (view: CreatorCommunityView) => void;
}) {
  const near = nearbyQuests(data.quests?.items || [], position).slice(0, 5);
  const followed = data.following?.items.slice(0, 3) || [];
  return (
    <>
      <h3>Near you</h3>
      {!position ? (
        <Empty>Turn on location on the map to see creator places nearby.</Empty>
      ) : !near.length ? (
        <Empty>
          No creator places within 5 km yet. Pin the first one in My creations.
        </Empty>
      ) : (
        <div className="creator-nearby">
          {near.map(({ quest, distance }) => (
            <QuestRow
              key={quest.id}
              quest={quest}
              distance={distance}
              navigate={navigate}
            />
          ))}
        </div>
      )}
      <div className="creator-heading">
        <h3>Creators you follow</h3>
        {followed.length > 0 && (
          <button
            className="text-button"
            onClick={() => navigate({ page: "following" })}
          >
            See all <ArrowRight size={18} />
          </button>
        )}
      </div>
      {!followed.length ? (
        <Empty>
          Follow a creator to see their new places here.{" "}
          <button
            className="text-button"
            onClick={() => navigate({ page: "creators" })}
          >
            Meet the creators <ArrowRight size={18} />
          </button>
        </Empty>
      ) : (
        followed.map((quest) => (
          <QuestRow
            key={quest.id}
            quest={quest}
            distance={placeDistance(quest.place, position)}
            navigate={navigate}
          />
        ))
      )}
    </>
  );
}
function QuestRow({
  quest,
  distance,
  navigate,
}: {
  quest: PublicCreatorQuest;
  distance: number | null;
  navigate: (view: CreatorCommunityView) => void;
}) {
  const template = quest.place ? PLACE_TEMPLATES[quest.place.template] : null;
  return (
    <article className="creator-quest-row">
      <button
        className="creator-quest-open"
        onClick={() => navigate({ page: "quest", questId: quest.id })}
      >
        <span className="creator-state">
          {template ? template.badge : "Quest"}
          {quest.price ? ` · ${nearText(quest.price)} NEAR` : " · Free"}
          {distance !== null ? ` · ${distanceText(distance)}` : ""}
        </span>
        <h4>{quest.title}</h4>
        <small>By {quest.creator.displayName}</small>
        <ArrowRight size={22} />
      </button>
    </article>
  );
}
function QuestList({
  page,
  from,
  navigate,
  empty,
}: {
  page?: CreatorPage<PublicCreatorQuest>;
  from?: Point;
  navigate: (view: CreatorCommunityView) => void;
  empty: string;
}) {
  return !page?.items.length ? (
    <Empty>{empty}</Empty>
  ) : (
    <div>
      {page.items.map((quest) => {
        const distance = placeDistance(quest.place, from);
        return (
          <article className="creator-quest-row" key={quest.id}>
            <button
              className="creator-quest-open"
              onClick={() => navigate({ page: "quest", questId: quest.id })}
            >
              <span className="creator-state">
                {quest.place
                  ? PLACE_TEMPLATES[quest.place.template].badge
                  : "Free"}
                {distance !== null ? ` · ${distanceText(distance)}` : ""}
              </span>
              <h4>{quest.title}</h4>
              <p>
                {quest.description.length > 180
                  ? quest.description.slice(0, 180) + "…"
                  : quest.description}
              </p>
              <small>
                By {quest.creator.displayName} · reviewed revision{" "}
                {quest.revision}
              </small>
              <ArrowRight size={22} />
            </button>
          </article>
        );
      })}
    </div>
  );
}
function Progression({ me }: { me: CreatorMe }) {
  return (
    <details className="creator-xp">
      <summary>
        {count(me.progression.availableXp)} available demo XP · Level{" "}
        {me.progression.level}
      </summary>
      <dl>
        <div>
          <dt>Earned</dt>
          <dd>{count(me.progression.earnedXp)} XP</dd>
        </div>
        <div>
          <dt>Committed</dt>
          <dd>{count(me.progression.lockedXp)} XP</dd>
        </div>
        <div>
          <dt>Available for your current level</dt>
          <dd>{count(me.progression.availableXp)} XP</dd>
        </div>
      </dl>
      <p>
        Publication commitments lower available XP. Closing returns the same XP
        after existing participants are resolved; it does not earn XP or repeat
        level rewards.
      </p>
    </details>
  );
}
function QuestDetail({
  playerId,
  data,
  busy,
  act,
  navigate,
  onSafety,
  money,
  position,
}: {
  playerId: string;
  data: Loaded;
  busy: boolean;
  act: Action;
  navigate: (view: CreatorCommunityView) => void;
  onSafety: (action: SafetyAction) => void;
  money?: CreatorMoneyBridge;
  position?: Point;
}) {
  const quest = data.quest,
    part = data.participation;
  const place = part?.content.place || quest?.place;
  const title = part?.content.title || quest?.title || "Your quest";
  const reportTarget = creatorReportTarget(quest, part);
  const creator = part?.creator || quest?.creator;
  return (
    <>
      <Back
        onClick={() =>
          navigate({ page: part ? "participations" : "community" })
        }
      >
        {part ? "Your started quests" : "Creator quests"}
      </Back>
      <h3>{title}</h3>
      {quest && (
        <button
          className="text-button"
          onClick={() =>
            navigate({ page: "creator", creatorId: quest.creator.id })
          }
        >
          By {quest.creator.displayName}
          <ArrowRight size={20} />
        </button>
      )}
      {place && <PlaceSummary place={place} from={position} />}
      {part ? (
        <article className="creator-accepted">
          <span className="creator-state">{statusName(part.state)}</span>
          <h4>Your accepted instructions</h4>
          <p className="creator-instructions">{part.content.description}</p>
          <p className="creator-hint">
            Revision {part.revision} · {statusName(part.questState)}
            {quest && quest.revision !== part.revision
              ? ` · Current public revision is ${quest.revision}; your accepted version stays unchanged.`
              : ""}
          </p>
          {data.completion && (
            <CreatorCompletionSection
              state={data.completion}
              playerId={playerId}
              busy={busy}
              act={act}
            />
          )}
          <p>
            {part.state === "resolved"
              ? "Independent completion review is recorded. No XP, item or GOLD reward is configured for this quest."
              : "Your start is saved. Completion needs independent review; the author cannot confirm it for you. No XP, item or GOLD reward is configured."}
          </p>
        </article>
      ) : (
        quest && (
          <>
            <p className="creator-instructions">{quest.description}</p>
            <p className="creator-hint">
              {quest.price
                ? `Paid unlock ${nearText(quest.price)} NEAR, supports the creator`
                : "Free quest"}{" "}
              · reviewed revision {quest.revision}. No XP, item or GOLD reward
              is configured. Starting saves these instructions; it does not
              prove a physical visit.
            </p>
            {quest.requirement && (
              <div className="creator-quote">
                <h4>Declared observation requirement</h4>
                <p>{quest.requirement.prompt}</p>
                <p className="creator-hint">
                  Policy {quest.requirement.policyVersion}: submit private text
                  for independent review, with up to 3 attempts. A third
                  rejection resolves participation as not completed. No GPS or
                  physical visit is verified. No reward is configured. Accepted
                  requirements and evidence stay available after closure or
                  blocking.
                </p>
              </div>
            )}
            {quest.creator.id === playerId ? (
              <button
                className="secondary-button"
                onClick={() => navigate({ page: "edit", questId: quest.id })}
              >
                Manage your quest <PencilSimple size={20} />
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/quests/${idPath(quest.id)}/participation`,
                    "POST",
                    {},
                    "Your start is confirmed. The accepted instructions are saved.",
                  )
                }
              >
                {quest.price ? "Start quest" : "Start free quest"}{" "}
                <ArrowRight size={20} />
              </button>
            )}
          </>
        )
      )}
      {money && quest && (
        <CreatorSupport
          questId={quest.id}
          ownQuest={quest.creator.id === playerId}
          money={money}
        />
      )}
      {reportTarget && (
        <details className="creator-safety-tools">
          <summary>Quest safety</summary>
          <p className="creator-hint">
            If a place feels unsafe, stop. Reporting requests private review;
            blocking hides public content. Neither action completes or cancels
            an existing quest.
          </p>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => onSafety({ kind: "report", target: reportTarget })}
          >
            <Flag size={20} />
            Report revision {reportTarget.revision}…
          </button>
          {creator && creator.id !== playerId && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                onSafety({
                  kind: "block",
                  creator,
                  blocked: true,
                  keepStartedQuest: part?.questId,
                })
              }
            >
              <ShieldSlash size={20} />
              Block creator…
            </button>
          )}
          <button
            className="text-button"
            onClick={() => navigate({ page: "blocked" })}
          >
            Manage blocked creators
            <ArrowRight size={20} />
          </button>
        </details>
      )}
    </>
  );
}

function PlaceSummary({ place, from }: { place: CreatorPlace; from?: Point }) {
  const template = PLACE_TEMPLATES[place.template];
  const first = place.points[0];
  const distance = placeDistance(place, from);
  return (
    <div className="creator-place">
      <strong>{template.name}</strong>
      <span>
        {place.template === "trail"
          ? `${place.points.length} stops · ${distanceText(trailLength(place.points))} walk`
          : "One pinned spot"}
        {distance !== null ? ` · start ${distanceText(distance)} away` : ""}
      </span>
      {first && (
        <a
          className="text-button"
          href={`https://www.openstreetmap.org/?mlat=${first.lat}&mlon=${first.lng}#map=18/${first.lat}/${first.lng}`}
          target="_blank"
          rel="noreferrer"
        >
          Open the start on a map <ArrowRight size={18} />
        </a>
      )}
    </div>
  );
}
function CreatorSafetyDialog({
  action,
  playerId,
  busy,
  act,
  onClose,
  onConfirmed,
}: {
  action: SafetyAction;
  playerId: string;
  busy: boolean;
  act: Action;
  onClose: () => void;
  onConfirmed: (stillHere: boolean) => void;
}) {
  return (
    <Dialog
      label={
        action.kind === "report"
          ? "Report quest revision"
          : action.blocked
            ? "Block creator"
            : "Unblock creator"
      }
      onClose={onClose}
    >
      <div className="creator-safety-dialog">
        {action.kind === "report" ? (
          <CreatorReportForm
            target={action.target}
            playerId={playerId}
            busy={busy}
            act={act}
            onClose={onClose}
            onConfirmed={onConfirmed}
          />
        ) : (
          <CreatorBlockForm
            action={action}
            busy={busy}
            act={act}
            onClose={onClose}
            onConfirmed={onConfirmed}
          />
        )}
      </div>
    </Dialog>
  );
}
function CreatorCompletionSection({
  state,
  playerId,
  busy,
  act,
}: {
  state: CreatorCompletionState;
  playerId: string;
  busy: boolean;
  act: Action;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      className="creator-completion"
      aria-label="Private completion progress"
    >
      <h4>
        {state.receipt ? "Observation completed" : "Your completion progress"}
      </h4>
      {state.legacy ? (
        <p>
          {state.state === "legacy-resolved"
            ? "This legacy participation has been resolved. It has no observation completion receipt and no configured reward. Your instructions remain available."
            : "This accepted revision has no declared observation requirement. A later author edit cannot add one to your existing start. Ask the host’s completion operator to review this legacy participation; your instructions remain available."}
        </p>
      ) : (
        <>
          <p>
            <strong>Accepted requirement · revision {state.revision}</strong>
          </p>
          <p className="creator-instructions">{state.requirement?.prompt}</p>
          <p className="creator-hint">
            Policy {state.policy?.version}: private text up to{" "}
            {state.policy?.maxEvidenceChars} characters, one pending review at a
            time, up to {state.policy?.maxAttempts} attempts. An independent
            third rejection resolves the obligation as NOT completed. No
            evidence expires automatically. Review checks text against the
            prompt; it does not prove GPS, a physical visit or the path walked.
            No XP, GOLD or item reward is configured.
          </p>
          {state.state === "pending" && (
            <p role="status">
              Your observation is awaiting independent review. Do not send
              another copy.
            </p>
          )}
          {state.state === "rejected" && (
            <p>
              The reviewer requested a correction. Read the private feedback
              before another attempt.
            </p>
          )}
          {state.state === "rejected-final" && (
            <p>
              The third review was rejected. Participation is resolved as NOT
              completed, with no completion receipt or reward. All submitted
              text and feedback remain below.
            </p>
          )}
          {state.receipt && (
            <div className="creator-quote">
              <strong>Completion confirmed · no reward configured</strong>
              <p>
                Reviewed observation completed for accepted revision{" "}
                {state.receipt.revision}. {count(state.receipt.reward.xp)} XP ·{" "}
                {count(state.receipt.reward.gold)} GOLD · no item. This receipt
                does not establish a physical visit.
              </p>
              <small>Receipt: {state.receipt.id}</small>
            </div>
          )}
          {state.canSubmit && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => setOpen(true)}
            >
              Write private observation <PencilSimple size={20} />
            </button>
          )}
          {state.attempts.map((a) => (
            <details className="creator-safety-tools" key={a.id}>
              <summary>
                Attempt {a.attempt} ·{" "}
                {a.state === "pending"
                  ? "Awaiting review"
                  : a.state === "accepted"
                    ? "Accepted"
                    : "Rejected"}
              </summary>
              <p className="creator-instructions">{a.evidence}</p>
              {a.feedback && (
                <>
                  <strong>Private review feedback</strong>
                  <p className="creator-instructions">{a.feedback}</p>
                </>
              )}
            </details>
          ))}
        </>
      )}
      <details className="creator-safety-tools">
        <summary>Help with this participation</summary>
        <p>
          For a pending, legacy or disputed review, give the host's completion
          operator this reference. No public support or appeal channel is
          configured in this local slice; this reference does not send a message
          or settle your participation.
        </p>
        <p className="creator-instructions">
          Quest: {state.questId}
          <br />
          Accepted revision: {state.revision}
          <br />
          Explorer: {playerId}
        </p>
      </details>
      {open && (
        <CreatorEvidenceDialog
          state={state}
          playerId={playerId}
          busy={busy}
          act={act}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
function CreatorEvidenceDialog({
  state,
  playerId,
  busy,
  act,
  onClose,
}: {
  state: CreatorCompletionState;
  playerId: string;
  busy: boolean;
  act: Action;
  onClose: () => void;
}) {
  const draft = useFormDraft({
    playerId,
    form: "creator-observation",
    realm: `demo:creator-observation:${state.questId}:${state.revision}`,
    fields: { evidence: 1000 },
    initial: { evidence: "" },
  });
  const [consent, setConsent] = useState(false),
    [error, setError] = useState("");
  const attempt = state.attempts.length + 1;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!consent || busy) return;
    const revision = draft.revision;
    setError("");
    void act(
      `/quests/${idPath(state.questId)}/completion`,
      "POST",
      {
        revision: state.revision,
        evidence: draft.values.evidence,
        privateConsent: true,
      },
      "Your private observation was received. Independent review is pending; no reward or completion is confirmed yet.",
      () => {
        draft.discard(revision);
        onClose();
      },
      (e) => setError(e.message),
    );
  }
  return (
    <Dialog label="Submit private observation" onClose={onClose}>
      <div className="creator-safety-dialog">
        <h2>Your observation</h2>
        <p>
          Accepted revision {state.revision} · attempt {attempt}/
          {state.policy?.maxAttempts}
        </p>
        <p className="creator-instructions">{state.requirement?.prompt}</p>
        <p className="creator-hint">
          Text is private to you and authorized reviewers. Do not include
          contact details, precise location or other private information. No
          GPS, photo or file is attached. Acceptance confirms reviewed text, not
          physical presence. No reward is configured.
        </p>
        {attempt === state.policy?.maxAttempts && (
          <p>
            This is the final permitted attempt. A third independent rejection
            resolves this participation as NOT completed; it creates no
            completion receipt or reward. Evidence and feedback remain
            available.
          </p>
        )}
        <form className="creator-form" onSubmit={submit}>
          <label htmlFor="creator-observation-evidence">
            Observation text
            <textarea
              id="creator-observation-evidence"
              required
              maxLength={1000}
              rows={5}
              value={draft.values.evidence}
              readOnly={busy}
              onChange={(e) => {
                draft.setField("evidence", e.target.value);
                setConsent(false);
              }}
            />
          </label>
          <small>{draft.values.evidence.length}/1,000 characters</small>
          <p className="creator-hint">
            {draft.storageAvailable
              ? draft.restored
                ? "Your text was restored. Submission consent was not restored."
                : "Text stays in this browser until submitted or discarded; consent is never stored."
              : "Browser storage is unavailable. Keep this dialog open to retain your text."}
          </p>
          <label className="creator-check">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Send this text privately for independent completion review.
            </span>
          </label>
          {error && (
            <p className="creator-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="primary-button"
            disabled={busy || !consent || !draft.values.evidence.trim()}
          >
            {busy ? "Sending observation…" : "Submit for independent review"}
            <ArrowRight size={20} />
          </button>
          {draft.hasDraft && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                draft.discard();
                setConsent(false);
              }}
            >
              Discard local observation text
            </button>
          )}
          <button className="secondary-button" type="button" onClick={onClose}>
            {busy ? "Close · request may still finish" : "Cancel"}
          </button>
        </form>
      </div>
    </Dialog>
  );
}
function CreatorReportForm({
  target,
  playerId,
  busy,
  act,
  onClose,
  onConfirmed,
}: {
  target: CreatorReportTarget;
  playerId: string;
  busy: boolean;
  act: Action;
  onClose: () => void;
  onConfirmed: (stillHere: boolean) => void;
}) {
  const draft = useFormDraft({
    playerId,
    form: "creator-report",
    realm: `demo:creator-report:${target.questId}:${target.revision}`,
    fields: { detail: 1000 },
    initial: { detail: "" },
  });
  const [reason, setReason] = useState<CreatorReportReason | "">(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason || !confirmed || busy) return;
    const revision = draft.revision;
    setError("");
    void act(
      `/quests/${idPath(target.questId)}/reports`,
      "POST",
      { revision: target.revision, reason, detail: draft.values.detail },
      "Your report has been received privately. It has not closed the quest or cancelled your participation.",
      (stillHere) => {
        draft.discard(revision);
        onConfirmed(stillHere);
      },
      (e) => setError(e.message),
    );
  }
  return (
    <>
      <h2>Report this quest</h2>
      <p>
        <strong>{target.title}</strong>
        <br />
        Revision {target.revision} · {"demo quest"}
      </p>
      <p className="creator-hint">
        Your reason and optional text are stored privately for authorized
        review. They are not shown to the creator or other explorers. Do not
        include your location, contact details or other private information. No
        GPS, photo or file is attached.
      </p>
      <p className="creator-hint">
        A report requests review. It does not hide the quest, cancel your start,
        prove completion or guarantee a response time. Stop if a place feels
        unsafe. Only one report per quest is accepted.
      </p>
      <form className="creator-form" onSubmit={submit}>
        <label htmlFor="creator-report-reason">
          Reason
          <select
            id="creator-report-reason"
            required
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value as CreatorReportReason | "");
              setConfirmed(false);
            }}
          >
            <option value="">Choose a reason</option>
            <option value="unsafe-place">Unsafe place or instructions</option>
            <option value="abuse">Abuse or harassment</option>
            <option value="misleading">Misleading quest</option>
            <option value="other">Other concern</option>
          </select>
        </label>
        <label htmlFor="creator-report-detail">
          Optional context
          <textarea
            id="creator-report-detail"
            rows={4}
            maxLength={1000}
            value={draft.values.detail}
            readOnly={busy}
            onChange={(e) => {
              draft.setField("detail", e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <small>{draft.values.detail.length}/1,000 characters</small>
        <p className="creator-hint">
          {!draft.storageAvailable
            ? "Browser storage is unavailable. Keep this dialog open to retain your text."
            : draft.restored
              ? "Your optional text was restored. Choose a reason and confirm again."
              : "Only optional text is retained in this browser until sent or discarded. Reason and confirmation are never restored."}
        </p>
        <label className="creator-check">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            Send this revision and selected reason for private review.
          </span>
        </label>
        {error && (
          <p className="creator-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={busy || !reason || !confirmed}
        >
          {busy ? "Sending report…" : "Send private report"}
          <Flag size={20} />
        </button>
        {draft.hasDraft && (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => {
              draft.discard();
              setConfirmed(false);
            }}
          >
            Discard local report text
          </button>
        )}
        <button className="secondary-button" type="button" onClick={onClose}>
          {busy ? "Close · request may still finish" : "Cancel"}
        </button>
      </form>
    </>
  );
}
function CreatorBlockForm({
  action,
  busy,
  act,
  onClose,
  onConfirmed,
}: {
  action: Extract<SafetyAction, { kind: "block" }>;
  busy: boolean;
  act: Action;
  onClose: () => void;
  onConfirmed: (stillHere: boolean) => void;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || busy) return;
    setError("");
    void act(
      `/creators/${idPath(action.creator.id)}/block`,
      "PUT",
      { blocked: action.blocked },
      action.blocked
        ? "Creator block confirmed. Public content is hidden between you; your accepted quest instructions remain available."
        : "Your block was removed. Current public content may appear again; a block set by the other creator is unchanged.",
      onConfirmed,
      (e) => setError(e.message),
    );
  }
  return (
    <>
      <h2>{action.blocked ? "Block creator?" : "Remove your block?"}</h2>
      <p>
        <strong>{action.creator.displayName || "This creator"}</strong>
      </p>
      <p>
        {action.blocked
          ? "This uses the same block as map notes. Public notes, profiles, follows, creator discovery and presence are hidden between you in both directions. Existing follow records are not deleted."
          : "Removing your block may make current public content visible again. It cannot remove a block set by the other creator or restore content that is private, removed or closed."}
      </p>
      <p>
        Your accepted quest instructions stay in Your started quests. Blocking
        or unblocking does not quit a quest, complete it, resolve obligations or
        create a reward.
      </p>
      <form className="creator-form" onSubmit={submit}>
        <label className="creator-check">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I understand this changes public visibility between us.</span>
        </label>
        {error && (
          <p className="creator-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary-button"
          disabled={busy || !confirmed}
          type="submit"
        >
          {busy
            ? "Confirming…"
            : action.blocked
              ? "Confirm creator block"
              : "Remove my block"}
          <ShieldSlash size={20} />
        </button>
        <button className="secondary-button" type="button" onClick={onClose}>
          {busy ? "Close · request may still finish" : "Cancel"}
        </button>
      </form>
    </>
  );
}
function ProfileEditor({
  me,
  playerId,
  busy,
  act,
  navigate,
}: {
  me: CreatorMe;
  playerId: string;
  busy: boolean;
  act: Action;
  navigate: (view: CreatorCommunityView) => void;
}) {
  const draft = useFormDraft({
    playerId,
    form: "creator-profile",
    realm: "demo:creator-profile",
    fields: PROFILE_FIELDS,
    initial: { displayName: me.profile.displayName, bio: me.profile.bio },
  });
  const [visible, setVisible] = useState(me.profile.public),
    [consent, setConsent] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    const revision = draft.revision;
    void act(
      "/profile",
      "PUT",
      {
        expectedVersion: me.profile.version,
        profile: { ...draft.values, public: visible },
        publicConsent: visible && consent,
      },
      "Your profile change is confirmed.",
      () => draft.discard(revision),
    );
  }
  return (
    <>
      <Back onClick={() => navigate({ page: "mine" })}>My creations</Back>
      <h3>Your creator profile</h3>
      <p>
        Choose the name and bio other explorers may see. Your private account
        name is not copied here.
      </p>
      <form className="creator-form" onSubmit={submit}>
        <label htmlFor="creator-display-name">
          Public display name
          <input
            id="creator-display-name"
            value={draft.values.displayName}
            onChange={(event) =>
              draft.setField("displayName", event.target.value)
            }
            required
            maxLength={80}
            autoComplete="nickname"
            readOnly={busy}
          />
        </label>
        <label htmlFor="creator-bio">
          About your quests
          <textarea
            id="creator-bio"
            value={draft.values.bio}
            onChange={(event) => draft.setField("bio", event.target.value)}
            maxLength={1000}
            rows={4}
            readOnly={busy}
          />
        </label>
        <label className="creator-check">
          <input
            type="checkbox"
            checked={visible}
            disabled={busy}
            onChange={(event) => {
              setVisible(event.target.checked);
              setConsent(false);
            }}
          />
          <span>Make my creator profile public</span>
        </label>
        {visible && (
          <>
            <p className="creator-hint">
              Your display name, bio and approved quests will be visible to
              other explorers. This demo profile is stored by QuestLayer; it is
              not an on-chain profile.
            </p>
            <label className="creator-check">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>I agree to publish this profile text publicly.</span>
            </label>
          </>
        )}
        <DraftHint
          restored={draft.restored}
          available={draft.storageAvailable}
          profile
        />
        <button
          className="primary-button"
          disabled={busy || (visible && !consent)}
          type="submit"
        >
          {busy
            ? "Saving…"
            : visible
              ? "Save public profile"
              : "Save private profile"}
          <Check size={20} />
        </button>
        {draft.hasDraft && (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => draft.discard()}
          >
            Discard local text changes
          </button>
        )}
      </form>
    </>
  );
}
function DraftHint({
  restored,
  available,
  profile = false,
}: {
  restored: boolean;
  available: boolean;
  profile?: boolean;
}) {
  return (
    <p className="creator-hint">
      {!available
        ? "Browser storage is unavailable. Keep this tab open to retain this text."
        : restored
          ? "Your local text draft was restored. Review it before saving; consent is never restored."
          : profile
            ? "Text changes stay in this browser until you save or discard them. Public visibility requires your explicit consent."
            : "Text changes stay in this browser until you save or discard them. They are private until a publication is approved."}
    </p>
  );
}

function QuestEditor({
  playerId,
  quest,
  me,
  capability,
  client,
  busy,
  act,
  navigate,
  position,
}: {
  playerId: string;
  quest?: OwnedCreatorQuest;
  me: CreatorMe;
  capability: CreatorCapability;
  client: CreatorClient;
  busy: boolean;
  act: Action;
  navigate: (view: CreatorCommunityView) => void;
  position?: Point;
}) {
  const savedPlace = quest?.draft.place;
  const [template, setTemplate] = useState<CreatorPlaceTemplate | null>(
    savedPlace?.template ?? (quest ? null : "visit"),
  );
  const [points, setPoints] = useState<Point[]>(savedPlace?.points ?? []);
  const [placeError, setPlaceError] = useState("");
  const savedPrice =
    quest?.draft.price && quest.draft.price !== "0" ? quest.draft.price : "";
  const [paid, setPaid] = useState(!!savedPrice);
  const [priceText, setPriceText] = useState(
    savedPrice ? formatNativeNear(savedPrice) : "",
  );
  let priceValue = "0",
    priceProblem = "";
  try {
    priceValue = paid ? parseAccessPrice(priceText) : "0";
    if (paid && priceValue === "0")
      priceProblem = "Enter a price, or keep it free.";
  } catch (error) {
    priceProblem = (error as Error).message;
  }
  const priceChanged = priceValue !== (savedPrice || "0");
  const placeChanged =
    JSON.stringify(template ? { template, points } : null) !==
    JSON.stringify(savedPlace ?? null);
  const draft = useFormDraft({
    playerId,
    form: "creator-quest",
    realm: `demo:quest:${quest?.id || "new"}`,
    fields: QUEST_FIELDS,
    initial: {
      title: quest?.draft.title || "",
      description: quest?.draft.description || "",
    },
  });
  const requirementDraft = useFormDraft({
    playerId,
    form: "creator-quest-requirement",
    realm: `demo:quest:${quest?.id || "new"}`,
    fields: { prompt: 500 },
    initial: { prompt: quest?.draft.requirement?.prompt || "" },
  });
  const [observation, setObservation] = useState(
    !!quest?.draft.requirement || !!requirementDraft.values.prompt,
  );
  const hasChanges =
    draft.hasDraft ||
    requirementDraft.hasDraft ||
    placeChanged ||
    priceChanged ||
    observation !== !!quest?.draft.requirement;
  const newIdentity = useMemo(
    () => (quest ? null : creatorDraftIdentity(playerId)),
    [playerId, quest?.id],
  );
  const [quote, setQuote] = useState<CreatorPublicationQuote | null>(null),
    [accepted, setAccepted] = useState(false),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteError, setQuoteError] = useState("");
  const [createUncertain, setCreateUncertain] = useState(false),
    [recovering, setRecovering] = useState(false),
    [recoveryError, setRecoveryError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const editable =
    !quest ||
    (["draft", "published", "rejected"].includes(quest.state) &&
      quest.latestState !== "pending_review");
  const pendingReview = quest?.latestState === "pending_review";
  async function reviewQuote() {
    if (!quest || quoteBusy) return;
    setQuoteBusy(true);
    setAccepted(false);
    setQuoteError("");
    try {
      const next = await client.read<CreatorPublicationQuote>(
        `/quests/${idPath(quest.id)}/publication-quote`,
      );
      if (mounted.current) setQuote(next);
    } catch (error) {
      if (mounted.current)
        setQuoteError(
          error instanceof Error
            ? error.message
            : "Could not load the publication quote.",
        );
    } finally {
      if (mounted.current) setQuoteBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (template) {
      const rule = PLACE_TEMPLATES[template];
      if (points.length < rule.min || points.length > rule.max) {
        setPlaceError(
          template === "trail"
            ? "Pin at least 2 stops for a trail."
            : "Pin the place first.",
        );
        return;
      }
      if (trailLength(points) > 5000) {
        setPlaceError("Keep a trail under 5 km.");
        return;
      }
    }
    setPlaceError("");
    if (priceProblem) return;
    const revision = draft.revision;
    const requirementRevision = requirementDraft.revision;
    const questId = quest?.id || newIdentity!.id;
    const savedDraft = {
      title: draft.values.title,
      description: draft.values.description,
      ...(observation
        ? {
            requirement: {
              template: "observation-v1",
              policyVersion: "creator-observation-v1",
              prompt: requirementDraft.values.prompt,
            },
          }
        : {}),
      ...(template ? { place: { template, points } } : {}),
      ...(priceValue !== "0" ? { price: priceValue } : {}),
    };
    const saved = await act(
      quest ? `/quests/${idPath(quest.id)}/revisions` : "/quests",
      "POST",
      quest
        ? { expectedVersion: quest.version, draft: savedDraft }
        : { questId, draft: savedDraft },
      "Your draft is confirmed. It is not public until independently approved.",
      (stillHere) => {
        draft.discard(revision);
        requirementDraft.discard(requirementRevision);
        newIdentity?.clear();
        if (stillHere) navigate({ page: "edit", questId });
      },
    );
    if (!saved && !quest && mounted.current) setCreateUncertain(true);
  }
  async function recoverCreate() {
    if (!newIdentity || recovering) return;
    setRecovering(true);
    setRecoveryError("");
    try {
      const found = await client.read<OwnedCreatorQuest>(
        `/me/quests/${idPath(newIdentity.id)}`,
      );
      if (mounted.current) {
        newIdentity.clear();
        navigate({ page: "edit", questId: found.id });
      }
    } catch (error) {
      if (mounted.current)
        setRecoveryError(
          error instanceof Error
            ? error.message
            : "The prior save could not be found. Your text is retained.",
        );
    } finally {
      if (mounted.current) setRecovering(false);
    }
  }
  return (
    <>
      <Back onClick={() => navigate({ page: "mine" })}>My creations</Back>
      <div className="creator-heading">
        <h3>{quest ? quest.draft.title : "Write a free quest"}</h3>
        {quest && (
          <span className="creator-state">{statusName(quest.state)}</span>
        )}
      </div>
      <p className="creator-hint">
        Pick a template, pin it where you stand, then write clear and safe
        instructions. Only places you pin are shown; your live location is never
        shared.
      </p>
      {quest && hasChanges && !editable && (
        <details className="creator-saved-version">
          <summary>View saved revision {quest.latestRevision}</summary>
          <p>
            Your text fields below contain retained local changes. Review and
            public readers use saved revisions.
          </p>
          <h4>{quest.draft.title}</h4>
          <p className="creator-instructions">{quest.draft.description}</p>
        </details>
      )}
      <form className="creator-form" onSubmit={save}>
        {editable && (
          <AiQuestDraft
            template={template}
            disabled={busy}
            onSuggestion={(suggestion) => {
              draft.setField("title", suggestion.draft.title.slice(0, 100));
              draft.setField(
                "description",
                suggestion.draft.description.slice(0, 4000),
              );
              setTemplate(suggestion.draft.place.template);
              setPoints(suggestion.draft.place.points);
              setPlaceError("");
              setQuote(null);
              setAccepted(false);
            }}
          />
        )}
        <fieldset className="creator-templates" disabled={!editable || busy}>
          <legend>Template</legend>
          {(Object.keys(PLACE_TEMPLATES) as CreatorPlaceTemplate[]).map(
            (key) => (
              <label key={key} className="creator-template">
                <input
                  type="radio"
                  name="creator-template"
                  checked={template === key}
                  onChange={() => {
                    setTemplate(key);
                    setPoints((old) => old.slice(0, PLACE_TEMPLATES[key].max));
                    setPlaceError("");
                    setQuote(null);
                    setAccepted(false);
                  }}
                />
                <span>
                  <strong>{PLACE_TEMPLATES[key].name}</strong>
                  <small>{PLACE_TEMPLATES[key].hint}</small>
                </span>
              </label>
            ),
          )}
        </fieldset>
        {template && (
          <div className="creator-pins">
            {points.length > 0 && (
              <ol>
                {points.map((p, i) => (
                  <li key={`${p.lat},${p.lng},${i}`}>
                    {template === "trail" ? `Stop ${i + 1}` : "Pinned spot"}
                    {position
                      ? ` · ${distanceText(meters(position, p))} from you`
                      : ""}
                    {editable && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setPoints((old) => old.filter((_, j) => j !== i));
                          setQuote(null);
                          setAccepted(false);
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {template === "trail" && points.length > 1 && (
              <p className="creator-hint">
                Trail length {distanceText(trailLength(points))}.
              </p>
            )}
            {editable && points.length < PLACE_TEMPLATES[template].max && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !position}
                onClick={() => {
                  if (!position) return;
                  const next = {
                    lat: Math.round(position.lat * 1e5) / 1e5,
                    lng: Math.round(position.lng * 1e5) / 1e5,
                  };
                  setPoints((old) =>
                    PLACE_TEMPLATES[template].max === 1
                      ? [next]
                      : [...old, next],
                  );
                  setPlaceError("");
                  setQuote(null);
                  setAccepted(false);
                }}
              >
                <Plus size={20} />
                {template === "trail"
                  ? `Pin stop ${points.length + 1} where I stand`
                  : "Pin it where I stand"}
              </button>
            )}
            {!position && (
              <p className="creator-hint">
                Turn on location on the map to pin a place.
              </p>
            )}
            {placeError && <p role="alert">{placeError}</p>}
          </div>
        )}
        <fieldset className="creator-templates" disabled={!editable || busy}>
          <legend>Access</legend>
          <label className="creator-template">
            <input
              type="radio"
              name="creator-access"
              checked={!paid}
              onChange={() => setPaid(false)}
            />
            <span>
              <strong>Free</strong>
              <small>
                Anyone can start it. Explorers can still send gifts.
              </small>
            </span>
          </label>
          <label className="creator-template">
            <input
              type="radio"
              name="creator-access"
              checked={paid}
              onChange={() => setPaid(true)}
            />
            <span>
              <strong>Paid unlock</strong>
              <small>
                Explorers pay once to unlock: 80% to you, 20% to the city reward
                pot.
              </small>
            </span>
          </label>
          {paid && (
            <label htmlFor="creator-quest-price">
              Price in NEAR (0.01 to 10)
              <input
                id="creator-quest-price"
                inputMode="decimal"
                placeholder="0.5"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                aria-invalid={!!priceProblem}
              />
            </label>
          )}
          {paid && priceProblem && priceText && (
            <p role="alert">{priceProblem}</p>
          )}
          {paid && !priceProblem && (
            <p className="creator-hint">
              {nearText(priceValue)} NEAR. The price goes live after review;
              people who already unlocked keep access.
            </p>
          )}
        </fieldset>
        <label htmlFor="creator-quest-title">
          Quest title
          <input
            id="creator-quest-title"
            value={draft.values.title}
            onChange={(event) => {
              draft.setField("title", event.target.value);
              setQuote(null);
              setAccepted(false);
            }}
            required
            maxLength={100}
            readOnly={!editable || busy}
          />
        </label>
        <label htmlFor="creator-quest-description">
          Instructions
          <textarea
            id="creator-quest-description"
            value={draft.values.description}
            onChange={(event) => {
              draft.setField("description", event.target.value);
              setQuote(null);
              setAccepted(false);
            }}
            required
            maxLength={4000}
            rows={7}
            readOnly={!editable || busy}
          />
        </label>
        <label className="creator-check">
          <input
            type="checkbox"
            checked={observation}
            disabled={!editable || busy}
            onChange={(e) => {
              setObservation(e.target.checked);
              setQuote(null);
              setAccepted(false);
            }}
          />
          <span>
            Declare a private observation for independent completion review
          </span>
        </label>
        {observation && (
          <>
            <label htmlFor="creator-observation-prompt">
              Observation requirement
              <textarea
                id="creator-observation-prompt"
                maxLength={500}
                required
                rows={3}
                readOnly={!editable || busy}
                value={requirementDraft.values.prompt}
                onChange={(e) => {
                  requirementDraft.setField("prompt", e.target.value);
                  setQuote(null);
                  setAccepted(false);
                }}
              />
            </label>
            <p className="creator-hint">
              Operational policy creator-observation-v1: private text up to
              1,000 characters, up to 3 attempts, one pending review. A third
              independent rejection resolves as NOT completed. No automatic
              expiry, GPS verification or reward. Only new starts on an
              independently approved structured revision use this requirement;
              existing plain starts stay legacy.
            </p>
          </>
        )}
        <DraftHint
          restored={draft.restored || requirementDraft.restored}
          available={
            draft.storageAvailable && requirementDraft.storageAvailable
          }
        />
        {editable ? (
          <button className="primary-button" type="submit" disabled={busy}>
            {busy
              ? "Saving…"
              : quest
                ? "Save new revision"
                : "Save private draft"}
            <Check size={20} />
          </button>
        ) : (
          <p>
            {pendingReview
              ? "This revision is in review. Withdraw it before editing."
              : "This quest is closing or closed; the accepted versions remain protected."}
          </p>
        )}
        {hasChanges && (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => {
              draft.discard();
              requirementDraft.discard();
              setObservation(!!quest?.draft.requirement);
              setTemplate(savedPlace?.template ?? (quest ? null : "visit"));
              setPoints(savedPlace?.points ?? []);
              setPlaceError("");
              setPaid(!!savedPrice);
              setPriceText(savedPrice ? formatNativeNear(savedPrice) : "");
              setQuote(null);
              setAccepted(false);
            }}
          >
            Discard local text changes
          </button>
        )}
      </form>
      {createUncertain && !quest && (
        <div className="creator-quote">
          <p>
            A save may already have reached the server. Retry the same text or
            recover the saved quest before starting a new one. Your local text
            stays in New quest until you discard it.
          </p>
          <button
            className="secondary-button"
            disabled={busy || recovering}
            onClick={() => void recoverCreate()}
          >
            {recovering ? "Checking saved quest…" : "Recover previous save"}
            <ArrowClockwise size={20} />
          </button>
          {recoveryError && <p role="alert">{recoveryError}</p>}
        </div>
      )}
      {quest && (
        <section
          className="creator-publication"
          aria-label="Publication and closure"
        >
          <h4>Publication</h4>
          <p className="creator-hint">
            Revision {quest.latestRevision} ·{" "}
            {statusName(quest.latestState || quest.state)} ·{" "}
            {count(quest.lockedXp)} XP committed · {quest.openParticipations}{" "}
            participants in progress
          </p>
          {quest.publishedRevision !== null && (
            <p>
              Revision {quest.publishedRevision} is the approved version.
              Participants keep the version they accepted.
            </p>
          )}
          {quest.latestReviewReason && (
            <div className="creator-review-note">
              <h4>Review feedback</h4>
              <p>{quest.latestReviewReason}</p>
            </div>
          )}
          {pendingReview ? (
            <>
              <p>
                Independent review is pending. Submitting a draft does not
                reserve XP; availability is checked again at approval.
              </p>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/quests/${idPath(quest.id)}/withdraw-review`,
                    "POST",
                    { expectedVersion: quest.version },
                    "Review withdrawal confirmed. Save a new revision before resubmitting.",
                  )
                }
              >
                Withdraw review
              </button>
            </>
          ) : (
            quest.latestState === "draft" &&
            ["draft", "published"].includes(quest.state) && (
              <>
                <button
                  className="secondary-button"
                  disabled={busy || quoteBusy || hasChanges}
                  onClick={() => void reviewQuote()}
                >
                  {quoteBusy
                    ? "Loading quote…"
                    : "Review publication commitment"}
                  <ArrowRight size={20} />
                </button>
                {hasChanges && (
                  <p className="creator-hint">
                    Save or discard local text changes before reviewing
                    publication.
                  </p>
                )}
              </>
            )
          )}
          {quoteError && (
            <p className="creator-error" role="alert">
              {quoteError}
            </p>
          )}
          {quote && (
            <div className="creator-quote">
              <h4>Review before submission</h4>
              <p>
                <strong>
                  {count(quote.additionalLockedXp)} additional demo XP
                </strong>{" "}
                will be committed if an independent reviewer approves this
                version.
              </p>
              <p>
                Policy {quote.policyVersion} ·{" "}
                {count(quote.progression.availableXp)} XP currently available.
                Total quest commitment: {count(quote.xpCommitment)} XP.
              </p>
              <p>
                Committed XP does not count toward your current demo level. It
                returns after closure and existing participant obligations;
                returning it earns no extra XP or level grant.
              </p>
              {!me.profile.public && (
                <p className="creator-hint">
                  Your profile is private. This quest will not appear in public
                  discovery until you publish your creator profile.
                </p>
              )}
              <label className="creator-check">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={busy}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>
                  I accept this quoted publication commitment. Submission is not
                  publication.
                </span>
              </label>
              <button
                className="primary-button"
                disabled={
                  busy ||
                  !accepted ||
                  !quote.canSubmit ||
                  quote.expectedVersion !== quest.version ||
                  capability.reviewConfigured === false
                }
                onClick={() =>
                  void act(
                    `/quests/${idPath(quest.id)}/submit`,
                    "POST",
                    {
                      expectedVersion: quote.expectedVersion,
                      expectedPolicyVersion: quote.policyVersion,
                    },
                    "Review submission confirmed. The current publication state is shown below.",
                    () => {
                      setQuote(null);
                      setAccepted(false);
                    },
                  )
                }
              >
                Submit for independent review <ArrowRight size={20} />
              </button>
              {capability.reviewConfigured === false && (
                <p className="creator-hint">
                  Publication waits for independent review to be configured.
                </p>
              )}
            </div>
          )}
          {!["closing", "closed"].includes(quest.state) && (
            <details className="creator-close">
              <summary>Close this quest</summary>
              <p>
                New starts stop immediately. Accepted participant instructions
                remain available. Committed XP is released only after their
                obligations are independently resolved.
              </p>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/quests/${idPath(quest.id)}/close`,
                    "POST",
                    { expectedVersion: quest.version },
                    "Quest closure confirmed. Existing participants keep their accepted revision.",
                  )
                }
              >
                {quest.publishedRevision === null
                  ? "Close this draft"
                  : "Stop new starts"}
              </button>
            </details>
          )}
          {quest.state === "closing" && (
            <>
              <p>
                {quest.openParticipations
                  ? `${quest.openParticipations} participant obligations must be independently resolved before XP can return.`
                  : "All recorded participant obligations are resolved. You can close this quest and return its commitment."}
              </p>
              <button
                className="primary-button"
                disabled={busy || quest.openParticipations > 0}
                onClick={() =>
                  void act(
                    `/quests/${idPath(quest.id)}/finalize`,
                    "POST",
                    { expectedVersion: quest.version },
                    "Final closure confirmed. Current available XP is refreshed; no new earning or level reward is created.",
                  )
                }
              >
                Finalize closure and return XP <ArrowRight size={20} />
              </button>
            </>
          )}
          {quest.state === "closed" && (
            <p>
              This stable quest identity is closed. Its existing instructions
              and receipts are retained.
            </p>
          )}
        </section>
      )}
    </>
  );
}
