import { EmptyState } from "./EmptyState";
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
  BookmarkSimple,
  Camera,
  Check,
  Eye,
  EyeSlash,
  PencilSimple,
  Plus,
  UserPlus,
  UsersThree,
  Flag,
  Globe,
  Info,
  MapPin,
  Path,
  ShieldSlash,
  Target,
  X,
} from "@phosphor-icons/react";
import { ArrowRight, ArrowLeft } from "./dir-icons";
import { Ghost } from "./Ghost";
import {
  CreatorEarningsPanel,
  CreatorSupport,
  type CreatorMoneyBridge,
} from "./CreatorMoney";
import { api, ApiError, meters } from "./api";
import { parseAccessPrice, nearText } from "./creator-money-quote";
import { formatNativeNear } from "./native-amounts";
import { Dialog } from "./Dialog";
import { InfoTip } from "./InfoTip";
import { mapKitUrl } from "./map-kit";
import { QuestFeedback, questPhotoData } from "./QuestFeedback";
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
  type CreatorXpTable,
  type OwnedCreatorQuest,
  type PublicCreatorQuest,
  type QuestMapTarget,
} from "./creator-community-types";
import type { Player } from "./types";
import {
  BotTag,
  CommunityRow,
  ExplorerAvatar,
  FilterChips,
  Stars,
  XpReward,
  type ArtKind,
} from "./CommunityCards";
import "./creator-community.css";
import "./quest-detail.css";
import { tr } from "./i18n";

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
  /** "Go" on a quest with a place: show it on the map and point the way. */
  onGo?: (target: QuestMapTarget) => void;
  /** Keeps a saved rating on chain as well; runs in the background. */
  onRate?: (questId: string, stars: number) => void;
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
    pending_review: tr("In review"),
    published: tr("Published"),
    draft: tr("Draft"),
    rejected: tr("Review rejected"),
    closing: tr("Closing"),
    closed: tr("Closed"),
    withdrawn: tr("Review withdrawn"),
    approved: tr("Approved"),
    open: tr("In progress"),
    resolved: tr("Review complete"),
  })[state] || state;

export const PLACE_TEMPLATES: Record<
  CreatorPlaceTemplate,
  { name: string; badge: string; hint: string; max: number; min: number }
> = {
  visit: {
    get name() { return tr("Visit a place"); },
    get badge() { return tr("Visit"); },
    get hint() { return tr("Pin one spot. Explorers go there and tell what they found."); },
    min: 1,
    max: 1,
  },
  trail: {
    get name() { return tr("Walk a trail"); },
    get badge() { return tr("Trail"); },
    get hint() { return tr("Pin 2 to 6 stops in walking order, under 5 km in total."); },
    min: 2,
    max: 6,
  },
  chest: {
    get name() { return tr("Hide a chest"); },
    get badge() { return tr("Chest"); },
    get hint() { return tr("Pin where your chest waits. Explorers open it on the spot."); },
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
      const quests = await client.read<CreatorPage<PublicCreatorQuest>>(
        "/quests?limit=50",
        signal,
      );
      return { me, quests };
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
      // The profile opens as a dialog over the creators list.
      const [creator, quests, creators] = await Promise.all([
        client.read<CreatorProfile & { following: boolean }>(
          `/creators/${idPath(view.creatorId)}`,
          signal,
        ),
        client.read<CreatorPage<PublicCreatorQuest>>(
          `/quests?creator=${idPath(view.creatorId)}&limit=20`,
          signal,
        ),
        client.read<CreatorPage<CreatorProfile>>("/creators?limit=20", signal),
      ]);
      return { me, creator, quests, creators };
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
  onGo,
  onRate,
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
  const [nearOnly, setNearOnly] = useState(false);
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
                tr("The action could not be confirmed. Retry the same terms."),
              ),
        );
      if (alive.current)
        setMessage(
          error instanceof Error
            ? error.message
            : tr("The action has not been confirmed. Refresh, then retry the same terms."),
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
            : tr("Could not load more quests."),
        );
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (!state.capability?.enabled)
    return (
      <EmptyState art="ghost" title={tr("Creator quests")} status action={state.loading ? undefined : { label: tr("Check availability"), onClick: () => setRefresh(n => n + 1) }}>
        {state.loading ? tr("Checking creator quests…") : state.error || tr("Creator quests are not enabled on this host yet. Nearby posts and sponsored tasks remain available in the Local chat and Tasks tabs.")}
      </EmptyState>
    );
  const data = state.data;
  const allTabs = [
    { page: "community", label: tr("All"), section: "quests" },
    { page: "near", label: tr("Nearby"), section: "quests" },
    { page: "following", label: tr("Following"), section: "quests" },
    { page: "participations", label: tr("Started"), section: "quests" },
    { page: "creators", label: tr("Creators"), section: "creators" },
    { page: "mine", label: tr("My creations"), section: "creators" },
  ] as const;
  type Chip = (typeof allTabs)[number]["page"];
  const chips = allTabs
    .filter((tab) => (screenSection ? tab.section === screenSection : true))
    .map((tab) => ({ id: tab.page as Chip, label: tab.label }));
  const chipValue: Chip =
    view.page === "edit" || view.page === "profile" || view.page === "blocked"
      ? "mine"
      : view.page === "creator"
        ? "creators"
        : view.page === "community"
          ? nearOnly
            ? "near"
            : "community"
          : (view.page as Chip);
  return (
    <section
      ref={section}
      className="creator-community"
      aria-label={tr("Creator community")}
      aria-busy={state.loading || busy}
    >
      <h2 className="sr-only" data-creator-heading tabIndex={-1}>
        {tr("Stories from explorers")}</h2>
      {view.page !== "quest" && <FilterChips
        label={tr("Creator community section")}
        options={chips}
        value={chipValue}
        onChange={(next) => {
          if (next === "near" || next === "community") {
            setNearOnly(next === "near");
            if (view.page !== "community") navigate({ page: "community" });
          } else navigate({ page: next });
        }}
      >
        <button
          type="button"
          className="cl-icon-button"
          aria-label={tr("Refresh creator quests")}
          title={tr("Refresh creator quests")}
          disabled={busy || state.loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <ArrowClockwise size={20} />
        </button>
      </FilterChips>}
      {message && (
        <p className="creator-message" role="status">
          {message}
        </p>
      )}
      {!client.durable && (
        <p className="creator-hint">
          {tr("Browser storage is unavailable. Keep this tab open until an action is confirmed.")}</p>
      )}
      {state.loading ? (
        <p role="status">{tr("Loading creator quests…")}</p>
      ) : state.error ? (
        <div className="creator-error" role="alert">
          <p>{state.error}</p>
          <button
            className="secondary-button"
            onClick={() => setRefresh((n) => n + 1)}
          >
            {tr("Try again")}{" "}<ArrowClockwise size={20} />
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
                  tr("Following preference confirmed."),
                )
              }
            >
              {tr("Stop following this creator")}</button>
          )}
        </div>
      ) : (
        data && (
          <>
            {(view.page === "community" || view.page === "following") && (
              <>
                <QuestCards
                  quests={data.quests?.items || []}
                  from={position}
                  nearOnly={view.page === "community" && nearOnly}
                  navigate={navigate}
                  empty={
                    view.page === "following"
                      ? tr("Follow a creator to see their published quests here. Following is free and does not share your location.")
                      : nearOnly
                        ? !position
                          ? tr("Turn on location on the map to see creator places nearby.")
                          : tr("No creator places within 5 km yet. Pin the first one in My creations.")
                        : tr("No reviewed creator quests are published yet. Explore the map, or start a draft in My creations.")
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
            {(view.page === "creators" || view.page === "creator") && (
              <>
                {!data.creators?.items.length ? (
                  <Empty>
                    {tr("Creators appear here after they deliberately publish a profile.")}</Empty>
                ) : (
                  <ul className="cl-list">
                    {data.creators.items.map((creator) => (
                      <li key={creator.id}>
                        <CreatorCard
                          creator={creator}
                          self={creator.id === player.id}
                          busy={busy}
                          onOpen={() => navigate({ page: "creator", creatorId: creator.id })}
                          onFollow={() =>
                            void act(
                              `/creators/${idPath(creator.id)}/follow`,
                              "PUT",
                              { following: !creator.following },
                              creator.following ? tr("You no longer follow {0}.", { 0: creator.displayName }) : tr("You follow {0}.", { 0: creator.displayName }),
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>
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
              <CreatorDialog
                creator={data.creator}
                quests={data.quests?.items || []}
                self={data.creator.id === player.id}
                busy={busy}
                from={position}
                navigate={navigate}
                onClose={() => navigate({ page: "creators" })}
                onFollow={() =>
                  void act(
                    `/creators/${idPath(data.creator!.id)}/follow`,
                    "PUT",
                    { following: !data.creator!.following },
                    data.creator!.following ? tr("You no longer follow {0}.", { 0: data.creator!.displayName }) : tr("You follow {0}.", { 0: data.creator!.displayName }),
                  )
                }
                onBlock={() =>
                  setSafety({
                    kind: "block",
                    creator: data.creator!,
                    blocked: true,
                  })
                }
              />
            )}
            {view.page === "participations" && (
              <>
                {!data.participations?.items.length ? (
                  <Empty>
                    {tr("Start a reviewed free quest to keep its instructions here.")}</Empty>
                ) : (
                  <ul className="cl-list">
                    {data.participations.items.map((part) => {
                      const art: ArtKind = part.content.place?.template ?? "story";
                      return (
                        <li key={part.questId}>
                          <CommunityRow
                            art={art}
                            title={part.content.title}
                            author={part.creator?.displayName || tr("Creator")}
                            meta={`${kindLabel(art)} · ${statusName(part.state)}`}
                            onOpen={() =>
                              navigate({ page: "quest", questId: part.questId })
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
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
                client={client}
                onGo={onGo}
                onRate={onRate}
              />
            )}
            {view.page === "mine" && (
              <>
                <div className="creator-heading">
                  <h3>{tr("My creations")}</h3>
                  <button
                    className="primary-button"
                    onClick={() => navigate({ page: "edit", questId: null })}
                  >
                    <Plus size={20} /> {" "}{tr("New quest")}</button>
                </div>
                {money && <CreatorEarningsPanel money={money} />}
                {data.me.creatorXp && <CreatorXpTable table={data.me.creatorXp} />}
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
                        tr("Set up your creator profile")}
                    </strong>
                    <small>
                      {data.me.profile.public
                        ? tr("Public profile")
                        : tr("Profile is private")}
                    </small>
                  </span>
                  <ArrowRight size={22} />
                </button>
                <button
                  className="text-button"
                  onClick={() => navigate({ page: "blocked" })}
                >
                  <ShieldSlash size={20} />
                  {tr("Blocked creators")}<ArrowRight size={20} />
                </button>
                {!data.mine?.items.length ? (
                  <Empty>
                    {tr("Write a title and clear instructions. Drafts do not lock XP or become public.")}</Empty>
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
                          {tr("Revision")}{" "}{quest.latestRevision} ·{" "}
                          {quest.lockedXp
                            ? tr("{0} XP committed", { 0: count(quest.lockedXp) })
                            : tr("No XP committed")}
                          {quest.openParticipations
                            ? tr(" · {0} in progress", { 0: quest.openParticipations })
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
                  {tr("My creations")}</Back>
                <h3>{tr("Blocked creators")}</h3>
                <p className="creator-hint">
                  {tr("This private list includes shared player blocks you set, including explorers without a public creator profile. Blocks also affect public notes, profiles, follows and presence in both directions. They do not erase your accepted quest instructions or resolve participant obligations.")}</p>
                {!data.blocks?.items.length ? (
                  <Empty>{tr("You have not blocked any creators.")}</Empty>
                ) : (
                  data.blocks.items.map((creator) => (
                    <article className="creator-row" key={creator.id}>
                      <ShieldSlash size={28} />
                      <div>
                        <h4>{creator.displayName || tr("Blocked explorer")}</h4>
                        {!creator.displayName && (
                          <small>{tr("Creator ID:")}{" "}{creator.id}</small>
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
                          {tr("Review unblock…")}</button>
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
    // One quiet line per empty list: several stacked illustrations with the same
    // title read as content and push the real lists off a phone screen.
    <p className="creator-empty-line" role="status">{children}</p>
  );
}
function More({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      className="secondary-button creator-more"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? tr("Loading…") : tr("Load more")}
      <ArrowRight size={20} />
    </button>
  );
}
const questArt = (quest: PublicCreatorQuest): ArtKind =>
  quest.kind ?? (quest.place ? quest.place.template : "story");
const kindLabel = (kind: ArtKind) =>
  kind === "story" ? tr("Story") : kind === "task" ? tr("Task") : PLACE_TEMPLATES[kind].badge;
/** Every creator quest in one compact list, nearest first when the map has a position. */
function QuestCards({
  quests,
  from,
  nearOnly = false,
  navigate,
  empty,
}: {
  quests: PublicCreatorQuest[];
  from?: Point;
  nearOnly?: boolean;
  navigate: (view: CreatorCommunityView) => void;
  empty: string;
}) {
  const rows = quests
    .map((quest) => ({ quest, distance: placeDistance(quest.place, from) }))
    .filter((r) => !nearOnly || (r.distance !== null && r.distance <= NEARBY_METERS))
    .sort((a, b) =>
      from ? (a.distance ?? Number.MAX_VALUE) - (b.distance ?? Number.MAX_VALUE) : 0,
    );
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="cl-list">
      {rows.map(({ quest, distance }) => {
        const art = questArt(quest);
        return (
          <li key={quest.id}>
            <CommunityRow
              art={art}
              title={quest.title}
              author={quest.creator.displayName}
              look={quest.creator.look}
              meta={kindLabel(art)}
              rating={quest.rating}
              photo={quest.photo}
              where={
                distance !== null
                  ? tr("{0} away", { 0: distanceText(distance) })
                  : quest.place
                    ? null
                    : tr("Anywhere")
              }
              reward={
                quest.price ? (
                  <span>{nearText(quest.price)} NEAR</span>
                ) : (
                  <span className="cl-free">{tr("Free")}</span>
                )
              }
              onOpen={() => navigate({ page: "quest", questId: quest.id })}
            />
          </li>
        );
      })}
    </ul>
  );
}
function CreatorStats({ creator }: { creator: CreatorProfile }) {
  const s = creator.stats;
  return (
    <span className="cl-creator-stats">
      {s && (
        <>
          <span>
            <b>{count(s.quests)}</b> {s.quests === 1 ? tr("quest") : tr("quests")}
          </span>
          <span>
            <b>{count(s.followers)}</b> {s.followers === 1 ? tr("follower") : tr("followers")}
          </span>
        </>
      )}
    </span>
  );
}
function FollowButton({
  creator,
  busy,
  onFollow,
  big = false,
}: {
  creator: CreatorProfile;
  busy: boolean;
  onFollow: () => void;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      className="cl-follow"
      aria-pressed={!!creator.following}
      aria-label={
        creator.following
          ? tr("Unfollow {0}", { 0: creator.displayName })
          : tr("Follow {0}", { 0: creator.displayName })
      }
      disabled={busy}
      onClick={onFollow}
    >
      {creator.following ? (
        <>
          <Check size={16} weight="bold" aria-hidden="true" /> {tr("Following")}
        </>
      ) : (
        <>
          <UserPlus size={big ? 20 : 16} weight="bold" aria-hidden="true" /> {tr("Follow")}
        </>
      )}
    </button>
  );
}
function CreatorCard({
  creator,
  self,
  busy,
  onOpen,
  onFollow,
}: {
  creator: CreatorProfile;
  self: boolean;
  busy: boolean;
  onOpen: () => void;
  onFollow: () => void;
}) {
  return (
    <div className="cl-creator">
      <button
        type="button"
        className="cl-avatar-button"
        onClick={onOpen}
        tabIndex={-1}
        aria-hidden="true"
      >
        <ExplorerAvatar look={creator.look} size={56} />
      </button>
      <button type="button" className="cl-creator-main" onClick={onOpen}>
        <strong>
          <span>{creator.displayName}</span>
        </strong>
        {creator.bio && <span className="cl-creator-bio">{creator.bio}</span>}
        <span className="cl-creator-stats">
          <CreatorStats creator={creator} />
          <BotTag look={creator.look} />
        </span>
      </button>
      {!self && <FollowButton creator={creator} busy={busy} onFollow={onFollow} />}
    </div>
  );
}
/** A creator's profile and quests, as its own dialog over the creators list. */
function CreatorDialog({
  creator,
  quests,
  self,
  busy,
  from,
  navigate,
  onClose,
  onFollow,
  onBlock,
}: {
  creator: CreatorProfile;
  quests: PublicCreatorQuest[];
  self: boolean;
  busy: boolean;
  from?: Point;
  navigate: (view: CreatorCommunityView) => void;
  onClose: () => void;
  onFollow: () => void;
  onBlock: () => void;
}) {
  const [info, setInfo] = useState(false);
  const s = creator.stats;
  return (
    <Dialog label={creator.displayName} history={false} onClose={onClose}>
      <div className="cl-profile">
        <button type="button" className="sheet-close" aria-label={tr("Close")} onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
        <header className="cl-profile-head">
          <ExplorerAvatar look={creator.look} size={88} />
          <div>
            <h2>
              {creator.displayName}
              <BotTag look={creator.look} />
            </h2>
            <p>
              {tr("Creator")}
              {creator.look ? ` · ${tr("Level {0}", { 0: creator.look.level })}` : ""}
            </p>
          </div>
        </header>
        {creator.bio && <p className="cl-profile-bio">{creator.bio}</p>}
        {s && (
          <dl className="cl-profile-stats">
            <div>
              <dt>{tr("Quests")}</dt>
              <dd>{count(s.quests)}</dd>
            </div>
            <div>
              <dt>{tr("Followers")}</dt>
              <dd>{count(s.followers)}</dd>
            </div>
            <div>
              <dt>{tr("Finished")}</dt>
              <dd>{count(s.completions)}</dd>
            </div>
            <div>
              <dt>{tr("Creator XP")}</dt>
              <dd>{count(s.xp)}</dd>
            </div>
          </dl>
        )}
        {!self && (
          <div className="cl-profile-actions">
            <FollowButton creator={creator} busy={busy} onFollow={onFollow} big />
            <button
              type="button"
              className="cl-info"
              aria-label={tr("About following and safety")}
              aria-expanded={info}
              onClick={() => setInfo((v) => !v)}
            >
              <Info size={22} aria-hidden="true" />
            </button>
          </div>
        )}
        {info && !self && (
          <div className="cl-info-panel">
            <p>{tr("Following is free. It neither pays the creator nor shares your location.")}</p>
            <p>{tr("Blocking hides public content between you. Your started quest instructions remain available.")}</p>
            <button type="button" className="text-button" disabled={busy} onClick={onBlock}>
              <ShieldSlash size={18} aria-hidden="true" /> {tr("Block creator…")}
            </button>
          </div>
        )}
        <h3>{tr("Quests by {0}", { 0: creator.displayName })}</h3>
        <QuestCards
          quests={quests}
          from={from}
          navigate={navigate}
          empty={tr("This creator has no published free quests at the moment.")}
        />
      </div>
    </Dialog>
  );
}
/** What the game gives a creator for building quests. */
function CreatorXpTable({ table }: { table: CreatorXpTable }) {
  return (
    <div className="cl-earn">
      <strong>{tr("Each published quest earns you XP")}</strong>
      <ul>
        <li>{tr("Story")} · <XpReward xp={table.publish.story} /></li>
        <li>{tr("Visit")} · <XpReward xp={table.publish.visit} /></li>
        <li>{tr("Chest")} · <XpReward xp={table.publish.chest} /></li>
        <li>{tr("Trail")} · <XpReward xp={table.publish.trail} /></li>
      </ul>
      <span>
        {tr("Trails get +{0} XP for every stop after the second.", { 0: table.trailStopBonus })}{" "}
        {tr("+{0} XP each time another explorer finishes it (up to {1} a day). QGOLD only comes from QGOLD you put into a quest yourself.", {
          0: table.completion,
          1: table.completionsPerDay,
        })}
      </span>
      {table.earned > 0 && (
        <span>{tr("You earned {0} XP from your quests so far.", { 0: count(table.earned) })}</span>
      )}
    </div>
  );
}
function Progression({ me }: { me: CreatorMe }) {
  return (
    <details className="creator-xp">
      <summary>
        {count(me.progression.availableXp)} {" "}{tr("available demo XP · Level")}{" "}
        {me.progression.level}
      </summary>
      <dl>
        <div>
          <dt>{tr("Earned")}</dt>
          <dd>{count(me.progression.earnedXp)} XP</dd>
        </div>
        <div>
          <dt>{tr("Committed")}</dt>
          <dd>{count(me.progression.lockedXp)} XP</dd>
        </div>
        <div>
          <dt>{tr("Available for your current level")}</dt>
          <dd>{count(me.progression.availableXp)} XP</dd>
        </div>
      </dl>
      <p>
        {tr("Publication commitments lower available XP. Closing returns the same XP after existing participants are resolved; it does not earn XP or repeat level rewards.")}</p>
    </details>
  );
}
/** The quest type art as a big tile, or the creator's own photo. */
function QuestHero({
  photo,
  art,
  onBack,
  backLabel,
}: {
  photo?: string;
  art: ArtKind;
  onBack: () => void;
  backLabel: string;
}) {
  const [broken, setBroken] = useState(false);
  const file = art === "story" ? "community" : art;
  return (
    <div className={`qd-hero${photo && !broken ? " has-photo" : ""}`}>
      {photo && !broken ? (
        <img className="qd-hero-photo" src={photo} alt="" onError={() => setBroken(true)} />
      ) : (
        <img className="qd-hero-art" src={mapKitUrl(`quests/${file}.png`)} width={96} height={96} alt="" draggable={false} />
      )}
      <button type="button" className="qd-back" aria-label={backLabel} title={backLabel} onClick={onBack}>
        <ArrowLeft size={22} aria-hidden="true" />
      </button>
      <span className="qd-kind">{kindLabel(art)}</span>
    </div>
  );
}

/**
 * One quest, one goal, one button (Lubos, 12 Nov 2026): photo, title, who made
 * it, what to do, and "Go". The description folds; the rules live under (i).
 * Once started the same screen is the progress: go there, answer, done.
 */
function QuestDetail({
  playerId,
  data,
  busy,
  act,
  navigate,
  onSafety,
  money,
  position,
  client,
  onGo,
  onRate,
}: {
  playerId: string;
  data: Loaded;
  busy: boolean;
  act: Action;
  navigate: (view: CreatorCommunityView) => void;
  onSafety: (action: SafetyAction) => void;
  money?: CreatorMoneyBridge;
  position?: Point;
  client: CreatorClient;
  onGo?: (target: QuestMapTarget) => void;
  /** Keeps a saved rating on chain as well; runs in the background. */
  onRate?: (questId: string, stars: number) => void;
}) {
  const quest = data.quest,
    part = data.participation;
  const content = part?.content;
  const questId = part?.questId || quest?.id || "";
  const place = content?.place || quest?.place;
  const title = content?.title || quest?.title || tr("Your quest");
  const description = content?.description || quest?.description || "";
  const requirement = content?.requirement || quest?.requirement;
  const photo = content?.photo || quest?.photo;
  const reportTarget = creatorReportTarget(quest, part);
  const creator = part?.creator || quest?.creator;
  const own = quest?.creator.id === playerId;
  const art: ArtKind = place?.template ?? "story";
  const distance = placeDistance(place, position);
  const target: QuestMapTarget | null = place?.points.length
    ? { questId, title, points: place.points }
    : null;
  // A paid quest starts only after the unlock below; the server enforces it too.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const needsUnlock = !!quest?.price && !!money && unlocked !== true && !part;
  const [rating, setRating] = useState(quest?.rating ?? null);
  const [more, setMore] = useState(false);
  const long = description.length > 140 || description.includes("\n");
  const revision = part?.revision ?? quest?.revision;
  return (
    <article className="qd">
      <QuestHero
        photo={photo}
        art={art}
        backLabel={part && !quest ? tr("Your started quests") : tr("Creator quests")}
        onBack={() => navigate({ page: part && !quest ? "participations" : "community" })}
      />
      <div className="qd-head">
        <h3>{title}</h3>
        <InfoTip label={title}>
          {quest?.price
            ? tr("Paid unlock {0} NEAR, supports the creator", { 0: nearText(quest.price) })
            : tr("Free quest")}
          {" · "}{tr("Revision")}{" "}{revision}
          {". "}{tr("A reviewer checks your answer, up to 3 tries. Starting keeps this version of the quest for you. No XP, item or GOLD reward is set, and nobody checks GPS or a physical visit.")}
        </InfoTip>
      </div>
      <div className="qd-meta">
        {creator && (
          <button
            type="button"
            className="qd-by"
            disabled={!quest}
            onClick={() => quest && navigate({ page: "creator", creatorId: quest.creator.id })}
          >
            <ExplorerAvatar look={quest?.creator.look} size={24} />
            <span>{creator.displayName || tr("Creator")}</span>
          </button>
        )}
        <Stars rating={rating} />
      </div>
      <ul className="qd-facts">
        {distance !== null && (
          <li><MapPin size={16} weight="fill" aria-hidden="true" />{distanceText(distance)}</li>
        )}
        {place?.template === "trail" && (
          <li><Path size={16} weight="bold" aria-hidden="true" />{tr("{0} stops · {1} walk", { 0: place.points.length, 1: distanceText(trailLength(place.points)) })}</li>
        )}
        {!place && <li><Globe size={16} weight="bold" aria-hidden="true" />{tr("Anywhere")}</li>}
        <li className={quest?.price ? "" : "qd-free"}>
          {quest?.price ? `${nearText(quest.price)} NEAR` : tr("Free")}
        </li>
      </ul>
      {requirement && (
        <p className="qd-goal">
          <Target size={22} weight="fill" aria-hidden="true" />
          <span>{requirement.prompt}</span>
        </p>
      )}
      {description && (
        <div className={`qd-desc${long && !more ? " is-folded" : ""}`}>
          <p id="qd-desc-text">{description}</p>
          {long && (
            <button type="button" className="text-button" aria-expanded={more} aria-controls="qd-desc-text" onClick={() => setMore((v) => !v)}>
              {more ? tr("Less") : tr("More")}
            </button>
          )}
        </div>
      )}
      {part ? (
        <QuestProgress
          part={part}
          state={data.completion}
          playerId={playerId}
          busy={busy}
          act={act}
          onMap={target && onGo ? () => onGo(target) : undefined}
        />
      ) : own ? (
        <button className="secondary-button qd-cta" onClick={() => navigate({ page: "edit", questId })}>
          <PencilSimple size={20} />{tr("Manage your quest")}
        </button>
      ) : (
        quest && (
          <>
            <button
              className="primary-button qd-cta"
              disabled={busy || needsUnlock}
              onClick={() =>
                void act(
                  `/quests/${idPath(quest.id)}/participation`,
                  "POST",
                  {},
                  tr("Quest started."),
                  () => target && onGo?.(target),
                )
              }
            >
              {tr("Go")}<ArrowRight size={22} />
            </button>
            {needsUnlock && (
              <p className="creator-hint" role="status">
                {unlocked === null ? tr("Checking your unlock…") : tr("Unlock this quest below to start it.")}
              </p>
            )}
          </>
        )
      )}
      {money && quest && (
        <details className="qd-fold" open={needsUnlock || undefined}>
          <summary>{tr("Support the creator")}</summary>
          <CreatorSupport questId={quest.id} ownQuest={!!own} money={money} onAccess={setUnlocked} />
        </details>
      )}
      {questId && <QuestFeedback client={client} questId={questId} onRated={setRating} onStars={onRate && ((stars) => onRate(questId, stars))} />}
      {reportTarget && (
        <details className="qd-fold creator-safety-tools">
          <summary>{tr("Quest safety")}</summary>
          <p className="creator-hint">
            {tr("If a place feels unsafe, stop. Reporting requests private review; blocking hides public content. Neither action completes or cancels an existing quest.")}</p>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => onSafety({ kind: "report", target: reportTarget })}
          >
            <Flag size={20} />
            {tr("Report revision")}{" "}{reportTarget.revision}…
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
              {tr("Block creator…")}</button>
          )}
          <button
            className="text-button"
            onClick={() => navigate({ page: "blocked" })}
          >
            {tr("Manage blocked creators")}<ArrowRight size={20} />
          </button>
        </details>
      )}
    </article>
  );
}

/**
 * A started quest as three plain steps: go there, answer, reviewed. The answer
 * is written right here; sending it is the consent to a private review.
 */
function QuestProgress({
  part,
  state,
  playerId,
  busy,
  act,
  onMap,
}: {
  part: CreatorParticipation;
  state?: CreatorCompletionState;
  playerId: string;
  busy: boolean;
  act: Action;
  onMap?: () => void;
}) {
  const draft = useFormDraft({
    playerId,
    form: "creator-observation",
    realm: `demo:creator-observation:${part.questId}:${part.revision}`,
    fields: { evidence: 1000 },
    initial: { evidence: "" },
  });
  const [error, setError] = useState("");
  const done = !!state?.receipt || state?.state === "completed";
  const failed = state?.state === "rejected-final";
  const pending = state?.state === "pending";
  const last = state?.attempts.at(-1);
  const tries = state?.policy?.maxAttempts ?? 3;
  const mapButton = onMap && (
    <button type="button" className={`${state?.canSubmit || done || failed || pending ? "secondary-button" : "primary-button"} qd-cta`} onClick={onMap}>
      <MapPin size={20} weight="fill" aria-hidden="true" />{tr("Show on map")}
    </button>
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !state || !draft.values.evidence.trim()) return;
    const revision = draft.revision;
    setError("");
    void act(
      `/quests/${idPath(part.questId)}/completion`,
      "POST",
      { revision: state.revision, evidence: draft.values.evidence, privateConsent: true },
      tr("Answer sent. A reviewer will check it."),
      () => draft.discard(revision),
      (e) => setError(e.message),
    );
  }
  return (
    <section className="qd-progress" aria-label={tr("Your progress")}>
      <span className={`qd-state${done ? " is-done" : failed ? " is-failed" : ""}`}>
        {done ? <Check size={18} weight="bold" aria-hidden="true" /> : null}
        {done
          ? tr("Done")
          : failed
            ? tr("Not completed")
            : pending
              ? tr("Waiting for review")
              : tr("In progress")}
      </span>
      {!done && !failed && mapButton}
      {state?.legacy && !done && (
        <p className="creator-hint">{tr("This quest has no question to answer. Ask the host to close it for you.")}</p>
      )}
      {state?.state === "rejected" && last?.feedback && (
        <p className="qd-feedback-note"><b>{tr("Not quite:")}</b>{" "}{last.feedback}</p>
      )}
      {failed && last?.feedback && (
        <p className="qd-feedback-note">{last.feedback}</p>
      )}
      {pending && last && <p className="qd-answer">{last.evidence}</p>}
      {done && last && <p className="qd-answer">{last.evidence}</p>}
      {state?.canSubmit && (
        <form className="qd-answer-form" onSubmit={submit}>
          <textarea
            aria-label={tr("Your answer")}
            placeholder={tr("Your answer")}
            required
            rows={2}
            maxLength={state.policy?.maxEvidenceChars ?? 1000}
            value={draft.values.evidence}
            readOnly={busy}
            onChange={(e) => draft.setField("evidence", e.target.value)}
          />
          {error && <p role="alert">{error}</p>}
          <button type="submit" className="primary-button qd-cta" disabled={busy || !draft.values.evidence.trim()}>
            {busy ? tr("Sending…") : tr("Send answer")}<ArrowRight size={20} />
          </button>
          <small className="qd-fine">
            {tr("Only you and the reviewer see it.")}
            {state.attempts.length > 0 ? ` ${tr("Try {0} of {1}", { 0: state.attempts.length + 1, 1: tries })}` : ""}
          </small>
        </form>
      )}
      {state?.receipt && <small className="qd-fine">{tr("Receipt:")}{" "}{state.receipt.id}</small>}
    </section>
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
          ? tr("Report quest revision")
          : action.blocked
            ? tr("Block creator")
            : tr("Unblock creator")
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
      tr("Your report has been received privately. It has not closed the quest or cancelled your participation."),
      (stillHere) => {
        draft.discard(revision);
        onConfirmed(stillHere);
      },
      (e) => setError(e.message),
    );
  }
  return (
    <>
      <h2>{tr("Report this quest")}</h2>
      <p>
        <strong>{target.title}</strong>
        <br />
        {tr("Revision")}{" "}{target.revision} · {tr("demo quest")}
      </p>
      <p className="creator-hint">
        {tr("Your reason and optional text are stored privately for authorized review. They are not shown to the creator or other explorers. Do not include your location, contact details or other private information. No GPS, photo or file is attached.")}</p>
      <p className="creator-hint">
        {tr("A report requests review. It does not hide the quest, cancel your start, prove completion or guarantee a response time. Stop if a place feels unsafe. Only one report per quest is accepted.")}</p>
      <form className="creator-form" onSubmit={submit}>
        <label htmlFor="creator-report-reason">
          {tr("Reason")}<select
            id="creator-report-reason"
            required
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value as CreatorReportReason | "");
              setConfirmed(false);
            }}
          >
            <option value="">{tr("Choose a reason")}</option>
            <option value="unsafe-place">{tr("Unsafe place or instructions")}</option>
            <option value="abuse">{tr("Abuse or harassment")}</option>
            <option value="misleading">{tr("Misleading quest")}</option>
            <option value="other">{tr("Other concern")}</option>
          </select>
        </label>
        <label htmlFor="creator-report-detail">
          {tr("Optional context")}<textarea
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
        <small>{draft.values.detail.length}{tr("/1,000 characters")}</small>
        <p className="creator-hint">
          {!draft.storageAvailable
            ? tr("Browser storage is unavailable. Keep this dialog open to retain your text.")
            : draft.restored
              ? tr("Your optional text was restored. Choose a reason and confirm again.")
              : tr("Only optional text is retained in this browser until sent or discarded. Reason and confirmation are never restored.")}
        </p>
        <label className="creator-check">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            {tr("Send this revision and selected reason for private review.")}</span>
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
          {busy ? tr("Sending report…") : tr("Send private report")}
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
            {tr("Discard local report text")}</button>
        )}
        <button className="secondary-button" type="button" onClick={onClose}>
          {busy ? tr("Close · request may still finish") : tr("Cancel")}
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
        ? tr("Creator block confirmed. Public content is hidden between you; your accepted quest instructions remain available.")
        : tr("Your block was removed. Current public content may appear again; a block set by the other creator is unchanged."),
      onConfirmed,
      (e) => setError(e.message),
    );
  }
  return (
    <>
      <h2>{action.blocked ? tr("Block creator?") : tr("Remove your block?")}</h2>
      <p>
        <strong>{action.creator.displayName || tr("This creator")}</strong>
      </p>
      <p>
        {action.blocked
          ? tr("This uses the same block as map notes. Public notes, profiles, follows, creator discovery and presence are hidden between you in both directions. Existing follow records are not deleted.")
          : tr("Removing your block may make current public content visible again. It cannot remove a block set by the other creator or restore content that is private, removed or closed.")}
      </p>
      <p>
        {tr("Your accepted quest instructions stay in Your started quests. Blocking or unblocking does not quit a quest, complete it, resolve obligations or create a reward.")}</p>
      <form className="creator-form" onSubmit={submit}>
        <label className="creator-check">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>{tr("I understand this changes public visibility between us.")}</span>
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
            ? tr("Confirming…")
            : action.blocked
              ? tr("Confirm creator block")
              : tr("Remove my block")}
          <ShieldSlash size={20} />
        </button>
        <button className="secondary-button" type="button" onClick={onClose}>
          {busy ? tr("Close · request may still finish") : tr("Cancel")}
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
      tr("Your profile change is confirmed."),
      () => draft.discard(revision),
    );
  }
  return (
    <>
      <Back onClick={() => navigate({ page: "mine" })}>{tr("My creations")}</Back>
      <h3>{tr("Your creator profile")}</h3>
      <p>
        {tr("Choose the name and bio other explorers may see. Your private account name is not copied here.")}</p>
      <form className="creator-form" onSubmit={submit}>
        <label htmlFor="creator-display-name">
          {tr("Public display name")}<input
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
          {tr("About your quests")}<textarea
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
          <span>{tr("Make my creator profile public")}</span>
        </label>
        {visible && (
          <>
            <p className="creator-hint">
              {tr("Your display name, bio and approved quests will be visible to other explorers. This demo profile is stored by QuestLayer; it is not an on-chain profile.")}</p>
            <label className="creator-check">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>{tr("I agree to publish this profile text publicly.")}</span>
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
            ? tr("Saving…")
            : visible
              ? tr("Save public profile")
              : tr("Save private profile")}
          <Check size={20} />
        </button>
        {draft.hasDraft && (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => draft.discard()}
          >
            {tr("Discard local text changes")}</button>
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
        ? tr("Browser storage is unavailable. Keep this tab open to retain this text.")
        : restored
          ? tr("Your local text draft was restored. Review it before saving; consent is never restored.")
          : profile
            ? tr("Text changes stay in this browser until you save or discard them. Public visibility requires your explicit consent.")
            : tr("Text changes stay in this browser until you save or discard them. They are private until a publication is approved.")}
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
      priceProblem = tr("Enter a price, or keep it free.");
  } catch (error) {
    priceProblem = (error as Error).message;
  }
  const priceChanged = priceValue !== (savedPrice || "0");
  const [photo, setPhoto] = useState(quest?.draft.photo || "");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  async function choosePhoto(file?: File) {
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const image = await questPhotoData(file);
      const saved = await api<{ photo: string }>("/creator-photos", { image });
      if (mounted.current) {
        setPhoto(saved.photo);
        setQuote(null);
        setAccepted(false);
      }
    } catch (error) {
      if (mounted.current)
        setPhotoError(
          error instanceof ApiError
            ? error.message
            : tr("That photo could not be opened. Choose it again."),
        );
    } finally {
      if (mounted.current) setPhotoBusy(false);
    }
  }
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
    photo !== (quest?.draft.photo || "") ||
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
            : tr("Could not load the publication quote."),
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
            ? tr("Pin at least 2 stops for a trail.")
            : tr("Pin the place first."),
        );
        return;
      }
      if (trailLength(points) > 5000) {
        setPlaceError(tr("Keep a trail under 5 km."));
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
      ...(photo ? { photo } : {}),
    };
    const saved = await act(
      quest ? `/quests/${idPath(quest.id)}/revisions` : "/quests",
      "POST",
      quest
        ? { expectedVersion: quest.version, draft: savedDraft }
        : { questId, draft: savedDraft },
      tr("Your draft is confirmed. It is not public until independently approved."),
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
            : tr("The prior save could not be found. Your text is retained."),
        );
    } finally {
      if (mounted.current) setRecovering(false);
    }
  }
  return (
    <>
      <Back onClick={() => navigate({ page: "mine" })}>{tr("My creations")}</Back>
      <div className="creator-heading">
        <h3>{quest ? quest.draft.title : tr("Write a free quest")}</h3>
        {quest && (
          <span className="creator-state">{statusName(quest.state)}</span>
        )}
      </div>
      <p className="creator-hint">
        {tr("Pick a template, pin it where you stand, then write clear and safe instructions. Only places you pin are shown; your live location is never shared.")}</p>
      {quest && hasChanges && !editable && (
        <details className="creator-saved-version">
          <summary>{tr("View saved revision")}{" "}{quest.latestRevision}</summary>
          <p>
            {tr("Your text fields below contain retained local changes. Review and public readers use saved revisions.")}</p>
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
        <div className={`qe-photo${photo ? " has-photo" : ""}`}>
          {photo && <img src={photo} alt="" />}
          <label className={`secondary-button${!editable || busy || photoBusy ? " is-disabled" : ""}`}>
            <Camera size={20} aria-hidden="true" />
            {photoBusy ? tr("Opening photo…") : photo ? tr("Change photo") : tr("Add photo")}
            <input
              className="sr-only"
              aria-label={tr("Choose a photo")}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!editable || busy || photoBusy}
              onChange={(e) => {
                void choosePhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {photo && editable && (
            <button type="button" className="text-button" disabled={busy} onClick={() => { setPhoto(""); setQuote(null); setAccepted(false); }}>
              {tr("Remove photo")}
            </button>
          )}
          {photoError && <p role="alert">{photoError}</p>}
        </div>
        <fieldset className="creator-templates" disabled={!editable || busy}>
          <legend>{tr("Template")}</legend>
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
                    {template === "trail" ? tr("Stop {0}", { 0: i + 1 }) : tr("Pinned spot")}
                    {position
                      ? tr(" · {0} from you", { 0: distanceText(meters(position, p)) })
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
                        {tr("Remove")}</button>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {template === "trail" && points.length > 1 && (
              <p className="creator-hint">
                {tr("Trail length")}{" "}{distanceText(trailLength(points))}.
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
                  ? tr("Pin stop {0} where I stand", { 0: points.length + 1 })
                  : tr("Pin it where I stand")}
              </button>
            )}
            {!position && (
              <p className="creator-hint">
                {tr("Turn on location on the map to pin a place.")}</p>
            )}
            {placeError && <p role="alert">{placeError}</p>}
          </div>
        )}
        <fieldset className="creator-templates" disabled={!editable || busy}>
          <legend>{tr("Access")}</legend>
          <label className="creator-template">
            <input
              type="radio"
              name="creator-access"
              checked={!paid}
              onChange={() => setPaid(false)}
            />
            <span>
              <strong>{tr("Free")}</strong>
              <small>
                {tr("Anyone can start it. Explorers can still send gifts.")}</small>
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
              <strong>{tr("Paid unlock")}</strong>
              <small>
                {tr("Explorers pay once to unlock: 80% to you, 20% to the global prize pool.")}</small>
            </span>
          </label>
          {paid && (
            <label htmlFor="creator-quest-price">
              {tr("Price in NEAR (0.01 to 10)")}<input
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
              {nearText(priceValue)} {" "}{tr("NEAR. The price goes live after review; people who already unlocked keep access.")}</p>
          )}
        </fieldset>
        <label htmlFor="creator-quest-title">
          {tr("Quest title")}<input
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
          {tr("Instructions")}<textarea
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
            {tr("Declare a private observation for independent completion review")}</span>
        </label>
        {observation && (
          <>
            <label htmlFor="creator-observation-prompt">
              {tr("Observation requirement")}<textarea
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
              {tr("Operational policy creator-observation-v1: private text up to 1,000 characters, up to 3 attempts, one pending review. A third independent rejection resolves as NOT completed. No automatic expiry, GPS verification or reward. Only new starts on an independently approved structured revision use this requirement; existing plain starts stay legacy.")}</p>
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
              ? tr("Saving…")
              : quest
                ? tr("Save new revision")
                : tr("Save private draft")}
            <Check size={20} />
          </button>
        ) : (
          <p>
            {pendingReview
              ? tr("This revision is in review. Withdraw it before editing.")
              : tr("This quest is closing or closed; the accepted versions remain protected.")}
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
            {tr("Discard local text changes")}</button>
        )}
      </form>
      {createUncertain && !quest && (
        <div className="creator-quote">
          <p>
            {tr("A save may already have reached the server. Retry the same text or recover the saved quest before starting a new one. Your local text stays in New quest until you discard it.")}</p>
          <button
            className="secondary-button"
            disabled={busy || recovering}
            onClick={() => void recoverCreate()}
          >
            {recovering ? tr("Checking saved quest…") : tr("Recover previous save")}
            <ArrowClockwise size={20} />
          </button>
          {recoveryError && <p role="alert">{recoveryError}</p>}
        </div>
      )}
      {quest && (
        <section
          className="creator-publication"
          aria-label={tr("Publication and closure")}
        >
          <h4>{tr("Publication")}</h4>
          <p className="creator-hint">
            {tr("Revision")}{" "}{quest.latestRevision} ·{" "}
            {statusName(quest.latestState || quest.state)} ·{" "}
            {count(quest.lockedXp)} {" "}{tr("XP committed ·")}{" "}{quest.openParticipations}{" "}
            {tr("participants in progress")}</p>
          {quest.publishedRevision !== null && (
            <p>
              {tr("Revision")}{" "}{quest.publishedRevision} {" "}{tr("is the approved version. Participants keep the version they accepted.")}</p>
          )}
          {quest.latestReviewReason && (
            <div className="creator-review-note">
              <h4>{tr("Review feedback")}</h4>
              <p>{quest.latestReviewReason}</p>
            </div>
          )}
          {pendingReview ? (
            <>
              <p>
                {tr("Independent review is pending. Submitting a draft does not reserve XP; availability is checked again at approval.")}</p>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/quests/${idPath(quest.id)}/withdraw-review`,
                    "POST",
                    { expectedVersion: quest.version },
                    tr("Review withdrawal confirmed. Save a new revision before resubmitting."),
                  )
                }
              >
                {tr("Withdraw review")}</button>
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
                    ? tr("Loading quote…")
                    : tr("Review publication commitment")}
                  <ArrowRight size={20} />
                </button>
                {hasChanges && (
                  <p className="creator-hint">
                    {tr("Save or discard local text changes before reviewing publication.")}</p>
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
              <h4>{tr("Review before submission")}</h4>
              <p>
                <strong>
                  {count(quote.additionalLockedXp)} {" "}{tr("additional demo XP")}</strong>{" "}
                {tr("will be committed if an independent reviewer approves this version.")}</p>
              <p>
                {tr("Policy")}{" "}{quote.policyVersion} ·{" "}
                {count(quote.progression.availableXp)} {" "}{tr("XP currently available. Total quest commitment:")}{" "}{count(quote.xpCommitment)} {" "}{tr("XP.")}</p>
              <p>
                {tr("Committed XP does not count toward your current demo level. It returns after closure and existing participant obligations; returning it earns no extra XP or level grant.")}</p>
              {!me.profile.public && (
                <p className="creator-hint">
                  {tr("Your profile is private. This quest will not appear in public discovery until you publish your creator profile.")}</p>
              )}
              <label className="creator-check">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={busy}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>
                  {tr("I accept this quoted publication commitment. Submission is not publication.")}</span>
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
                    tr("Review submission confirmed. The current publication state is shown below."),
                    () => {
                      setQuote(null);
                      setAccepted(false);
                    },
                  )
                }
              >
                {tr("Submit for independent review")}{" "}<ArrowRight size={20} />
              </button>
              {capability.reviewConfigured === false && (
                <p className="creator-hint">
                  {tr("Publication waits for independent review to be configured.")}</p>
              )}
            </div>
          )}
          {!["closing", "closed"].includes(quest.state) && (
            <details className="creator-close">
              <summary>{tr("Close this quest")}</summary>
              <p>
                {tr("New starts stop immediately. Accepted participant instructions remain available. Committed XP is released only after their obligations are independently resolved.")}</p>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/quests/${idPath(quest.id)}/close`,
                    "POST",
                    { expectedVersion: quest.version },
                    tr("Quest closure confirmed. Existing participants keep their accepted revision."),
                  )
                }
              >
                {quest.publishedRevision === null
                  ? tr("Close this draft")
                  : tr("Stop new starts")}
              </button>
            </details>
          )}
          {quest.state === "closing" && (
            <>
              <p>
                {quest.openParticipations
                  ? tr("{0} participant obligations must be independently resolved before XP can return.", { 0: quest.openParticipations })
                  : tr("All recorded participant obligations are resolved. You can close this quest and return its commitment.")}
              </p>
              <button
                className="primary-button"
                disabled={busy || quest.openParticipations > 0}
                onClick={() =>
                  void act(
                    `/quests/${idPath(quest.id)}/finalize`,
                    "POST",
                    { expectedVersion: quest.version },
                    tr("Final closure confirmed. Current available XP is refreshed; no new earning or level reward is created."),
                  )
                }
              >
                {tr("Finalize closure and return XP")}{" "}<ArrowRight size={20} />
              </button>
            </>
          )}
          {quest.state === "closed" && (
            <p>
              {tr("This stable quest identity is closed. Its existing instructions and receipts are retained.")}</p>
          )}
        </section>
      )}
    </>
  );
}
