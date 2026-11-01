// QuestLayer operator console client. All data is rendered with textContent.
"use strict";
(() => {
  const read = (k) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const write = (k, v) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {}
  };
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("token");
  if (fromHash) {
    write("ql-operator-token", fromHash);
    history.replaceState(null, "", location.pathname);
  }
  const token = fromHash || read("ql-operator-token");
  const $ = (s) => document.querySelector(s);
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat())
      if (c !== null && c !== undefined)
        node.append(c instanceof Node ? c : String(c));
    return node;
  };
  const time = (ms) => (ms ? new Date(ms).toLocaleString() : "—");
  let session = null;

  function flash(text, error = false) {
    const f = $("#flash");
    f.textContent = text;
    f.className = error ? "error" : "";
    f.hidden = false;
  }
  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token || ""}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), data);
    return data;
  }
  async function act(button, work, done) {
    button.disabled = true;
    try {
      const result = await work();
      flash(done(result));
      await refresh();
    } catch (e) {
      flash(e.message, true);
    } finally {
      button.disabled = false;
    }
  }

  // ---------------------------------------------------------------- tabs
  const tabs = [...document.querySelectorAll("[data-tab]")];
  function show(name) {
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.setAttribute("aria-selected", String(on));
      $(`#tab-${t.dataset.tab}`).hidden = !on;
    }
    write("ql-operator-tab", name);
    refresh();
  }
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));
  $("#refresh").addEventListener("click", () => refresh());
  const current = () =>
    tabs.find((t) => t.getAttribute("aria-selected") === "true").dataset.tab;

  // -------------------------------------------------------------- health
  function table(headers, rows) {
    return el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        {},
        el("thead", {}, el("tr", {}, headers.map((h) => el("th", {}, h)))),
        el(
          "tbody",
          {},
          rows.length
            ? rows.map((r) => el("tr", {}, r.map((c) => el("td", {}, c))))
            : el("tr", {}, el("td", { colspan: headers.length, class: "muted" }, "None")),
        ),
      ),
    );
  }
  async function renderHealth() {
    const r = await api("/api/report");
    const root = $("#tab-health");
    const cards = [
      el(
        "div",
        { class: "card" },
        el(
          "h2",
          {},
          "Status ",
          el("span", { class: `badge ${r.status}` }, r.status === "ok" ? "OK" : "Needs attention"),
        ),
        el("p", { class: "muted" }, `Generated ${time(r.generatedAt)}`),
        r.warnings.length
          ? el("ul", { class: "warnings" }, r.warnings.map((w) => el("li", {}, w)))
          : el("p", {}, "No warnings."),
      ),
    ];
    for (const c of r.cities)
      cards.push(
        el(
          "div",
          { class: "card" },
          el("h2", {}, `${c.cityId} · ${c.today}`),
          el("h3", {}, "Live worlds today"),
          table(
            ["World", "Zones", "Coins claimed", "Quest claims"],
            c.worlds.map((w) => [
              `${w.arena ? "Arena" : "GPS"} ${w.id}`,
              w.zones,
              `${w.coins.claimed} / ${w.coins.total}`,
              `${w.quests.claims} on ${w.quests.total} quests`,
            ]),
          ),
          el("h3", {}, "Preparation"),
          table(
            ["Day", "Job", "Attempts", "Stored plans"],
            c.preparation.map((p) => [
              p.day,
              p.job?.state || "not queued",
              p.job?.attempts ?? 0,
              p.storedPlans,
            ]),
          ),
          el("h3", {}, "Pauses"),
          table(
            ["Day", "Scope", "Reason", "By", ""],
            c.pauses.map((p) => [
              p.day,
              p.scope,
              p.reason,
              p.actor,
              el(
                "button",
                {
                  class: "ghost",
                  onclick: (e) =>
                    act(
                      e.currentTarget,
                      () =>
                        api("/api/world/resume", {
                          cityId: c.cityId,
                          day: p.day,
                          zone: p.scope === "day" ? null : Number(p.scope.slice(5)),
                          reason: "Resumed from console",
                          expectedVersion: p.version,
                        }),
                      () => `Resumed ${p.scope} on ${p.day}.`,
                    ),
                },
                "Resume",
              ),
            ]),
          ),
          el("h3", {}, "Day adjustments"),
          table(
            ["Day", "Left out", "Reason", "Published"],
            c.adjustments.map((a) => [
              a.day,
              a.excludeCandidates.join(", "),
              a.reason,
              a.publishedAs ? a.publishedAs.id : "not yet",
            ]),
          ),
          el("h3", {}, "Closed places"),
          table(["Place", "Version"], c.closedPlaces.map((p) => [p.id, p.version])),
          el("h3", {}, "Native days"),
          table(
            ["Day", "Id", "State"],
            c.nativeDays.map((n) => [n.day, n.id, n.state]),
          ),
        ),
      );
    const t = r.treasury;
    cards.push(
      el(
        "div",
        { class: "card" },
        el("h2", {}, "Treasury"),
        el("h3", {}, "Demo GOLD (micro units)"),
        table(
          ["Bucket", "Available", "Reserved", "Paid"],
          t.demo.buckets.map((b) => [b.bucket, b.availableU, b.reservedU, b.paidU]),
        ),
        el(
          "p",
          { class: "muted" },
          `${t.demo.funding.events} funding events, last ${time(t.demo.funding.lastAt)}`,
        ),
        el("h3", {}, "Native rewards (testnet)"),
        t.native
          ? el("pre", {}, JSON.stringify(t.native, null, 2))
          : el("p", { class: "muted" }, "Start the console with --chain to read the contract."),
      ),
    );
    root.replaceChildren(el("div", { class: "cards" }, cards));
  }

  // ---------------------------------------------------------- moderation
  const ACTIONS = {
    note: ["hide", "restore", "dismiss", "tombstone"],
    record: ["hide", "restore", "dismiss", "tombstone"],
    quest: ["hide", "dismiss"],
    evidence: ["hide", "restore", "dismiss", "tombstone"],
  };
  async function renderModeration() {
    const list = $("#mod-list");
    if (!session.moderation) {
      list.replaceChildren(el("p", { class: "muted" }, "Moderation is not available on this host."));
      return;
    }
    const q = await api(`/api/moderation/queue?state=${$("#mod-state").value}`);
    if (!q.items.length) {
      list.replaceChildren(el("p", {}, "The queue is empty."));
      return;
    }
    list.replaceChildren(
      el("p", { class: "muted" }, `${q.total} item(s)`),
      el(
        "div",
        { class: "cards" },
        q.items.map((item) => {
          const reason = el("input", {
            "aria-label": "Decision reason",
            placeholder: "Reason",
            minlength: "3",
            maxlength: "300",
          });
          return el(
            "div",
            { class: "card" },
            el(
              "h3",
              {},
              `${item.kind} `,
              el("span", { class: "badge warn" }, `${item.reportCount} report(s)`),
            ),
            el("p", { class: "muted" }, `${item.targetId} · state ${item.state} · author ${item.authorId || "—"}`),
            el("pre", {}, JSON.stringify(item.preview, null, 2)),
            el(
              "ul",
              {},
              item.reports.map((r) =>
                el("li", {}, `${r.reason}${r.detail ? `: ${r.detail}` : ""} (${time(r.reportedAt)})`),
              ),
            ),
            el(
              "div",
              { class: "item-actions" },
              reason,
              (ACTIONS[item.kind] || []).map((action) =>
                el(
                  "button",
                  {
                    class: action === "hide" || action === "tombstone" ? "" : "ghost",
                    onclick: (e) => {
                      if (reason.value.trim().length < 3) {
                        flash("Write a short reason first.", true);
                        reason.focus();
                        return;
                      }
                      if (action === "tombstone" && !confirm("Tombstone is permanent. Continue?")) return;
                      act(
                        e.currentTarget,
                        () =>
                          api("/api/moderation/decide", {
                            kind: item.kind,
                            targetId: item.targetId,
                            action,
                            reason: reason.value.trim(),
                          }),
                        () => `${action} recorded for ${item.kind} ${item.targetId}.`,
                      );
                    },
                  },
                  action,
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
  $("#mod-state").addEventListener("change", () => refresh());

  // ------------------------------------------------------- world controls
  let versions = null;
  const cityId = () => $("#w-city").value;
  const day = () => $("#w-day").value;
  function cityOptions() {
    const city = session.cities.find((c) => c.id === cityId());
    const options = (city?.candidates || []).map((p) =>
      el("option", { value: p.id }, `${p.name} (${p.sector})`),
    );
    $("#f-place [name=candidateId]").replaceChildren(...options.map((o) => o.cloneNode(true)));
    $("#f-adjust [name=exclude]").replaceChildren(...options);
  }
  async function renderWorld() {
    if (!cityId() || !day()) return;
    versions = await api(
      `/api/world/versions?cityId=${encodeURIComponent(cityId())}&day=${encodeURIComponent(day())}`,
    );
    const paused = Object.entries(versions.pauses)
      .filter(([, v]) => v.state === "paused")
      .map(([k]) => k);
    $("#w-state").textContent =
      `${day()}: ${versions.publishedAs ? `published (${versions.publishedAs.id})` : "not published yet"}` +
      ` · paused: ${paused.length ? paused.join(", ") : "nothing"}` +
      ` · adjustment: ${versions.adjustment?.state === "active" ? versions.adjustment.excludeCandidates.join(", ") : "none"}`;
  }
  $("#w-city").addEventListener("change", () => {
    cityOptions();
    renderWorld().catch((e) => flash(e.message, true));
  });
  $("#w-day").addEventListener("change", () => renderWorld().catch((e) => flash(e.message, true)));
  const reasonOf = (form) => form.querySelector("[name=reason]").value.trim();
  function submitter(form, run) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const button = e.submitter;
      act(button, () => run(button.value), (r) => r.message || `Done: ${button.value}.`);
    });
  }
  submitter($("#f-pause"), async (action) => {
    await renderWorld();
    const zoneValue = $("#f-pause [name=zone]").value;
    const scope = zoneValue === "" ? "day" : `zone:${zoneValue}`;
    return api(`/api/world/${action}`, {
      cityId: cityId(),
      day: day(),
      zone: zoneValue === "" ? null : Number(zoneValue),
      reason: reasonOf($("#f-pause")),
      expectedVersion: versions.pauses[scope]?.version || 0,
    });
  });
  submitter($("#f-place"), async (action) => {
    await renderWorld();
    const candidateId = $("#f-place [name=candidateId]").value;
    return api(`/api/world/${action}`, {
      cityId: cityId(),
      candidateId,
      reason: reasonOf($("#f-place")),
      expectedVersion: versions.places[candidateId]?.version || 0,
    });
  });
  submitter($("#f-adjust"), async (action) => {
    await renderWorld();
    const chosen = [...$("#f-adjust [name=exclude]").selectedOptions].map((o) => o.value);
    const body = {
      cityId: cityId(),
      day: day(),
      excludeCandidates: action === "clear-adjustment" ? [] : chosen,
      reason: reasonOf($("#f-adjust")),
      expectedVersion: versions.adjustment?.version || 0,
    };
    const result = await api(
      action === "preview" ? "/api/world/adjust?preview=1" : `/api/world/${action}`,
      body,
    );
    $("#adjust-preview").replaceChildren(
      ...(result.zones || []).map((z) => el("li", {}, `Slot ${z.slot} (${z.sector}): ${z.name}, tier ${z.tier}`)),
    );
    return {
      message:
        action === "preview"
          ? "Preview only. Nothing was saved."
          : `Saved ${action} for ${day()}.`,
    };
  });

  // --------------------------------------------------------------- audit
  async function renderAudit() {
    const a = await api("/api/audit");
    $("#tab-audit").replaceChildren(
      el(
        "div",
        { class: "cards" },
        el(
          "div",
          { class: "card" },
          el("h2", {}, "World operations"),
          table(
            ["When", "Who", "Action", "Details"],
            a.world.map((x) => [
              time(x.at),
              x.actor,
              x.kind,
              el("pre", {}, JSON.stringify(x.receipt, null, 1)),
            ]),
          ),
        ),
        el(
          "div",
          { class: "card" },
          el(
            "h2",
            {},
            "Moderation ",
            a.moderationChain
              ? el(
                  "span",
                  { class: `badge ${a.moderationChain.ok ? "ok" : "danger"}` },
                  a.moderationChain.ok ? "chain verified" : "chain broken",
                )
              : null,
          ),
          table(
            ["When", "Who", "Action", "Target"],
            a.moderation.map((x) => [
              time(x.created_at),
              x.operator || x.actor || "—",
              x.action,
              `${x.kind} ${x.target_id}`,
            ]),
          ),
        ),
      ),
    );
  }

  async function refresh() {
    try {
      const tab = current();
      if (tab === "health") await renderHealth();
      else if (tab === "moderation") await renderModeration();
      else if (tab === "world") await renderWorld();
      else await renderAudit();
    } catch (e) {
      flash(e.message, true);
    }
  }
  (async () => {
    try {
      session = await api("/api/session");
    } catch (e) {
      flash(e.message, true);
      return;
    }
    $("#who").textContent = ` · ${session.operator}`;
    $("#w-city").replaceChildren(
      ...session.cities.map((c) => el("option", { value: c.id }, c.name || c.id)),
    );
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: session.cities[0]?.timezone || "UTC",
    }).format(Date.now());
    $("#w-day").value = today;
    cityOptions();
    show(read("ql-operator-tab") || "health");
  })();
})();
