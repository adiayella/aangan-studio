import { STAGES } from "./config.js";
import { DEMO_LEADS } from "./demo-data.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const TZ = "Asia/Kolkata";
const KEY_STORE = "aangan_desk_key";

const state = { leads: [], tab: "action", decision: "all", q: "", selected: null, designer: "all", live: false, who: null, demo: false, key: null };

// ---- access: a private link carries the key in the #fragment (never sent to the server in the address) ----
function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  return { key: h.get("key"), lead: h.get("lead"), demo: h.has("demo") };
}
function initAccess() {
  const h = readHash();
  state.demo = h.demo;
  if (h.key) {
    try { localStorage.setItem(KEY_STORE, h.key); } catch {}
    state.key = h.key;
    history.replaceState(null, "", location.pathname + (h.lead ? `#lead=${encodeURIComponent(h.lead)}` : "")); // the key leaves the address bar immediately
  } else {
    try { state.key = localStorage.getItem(KEY_STORE); } catch { state.key = null; }
  }
  if (h.lead) state.selected = h.lead;
}

const VERDICT = {
  QUALIFIED: ["Selected", "ok"], NEEDS_REVIEW: ["Needs review", "warn"],
  ESCALATION: ["Urgent", "bad"], UNQUALIFIED: ["Declined", ""],
};
const DECISIONS = [["all", "All"], ["QUALIFIED", "Selected"], ["NEEDS_REVIEW", "Needs review"], ["UNQUALIFIED", "Declined"], ["ESCALATION", "Urgent"]];
const fmtDT = (iso) => new Date(iso).toLocaleString("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
const stageLabel = (k) => (STAGES.find((s) => s[0] === k) || [k, k])[1];

// ---- data ----
async function api(path, opts = {}) {
  const r = await fetch(`/api/desk${path}`, { ...opts, headers: { "x-desk-key": state.key || "", "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 401) { const e = new Error("locked"); e.locked = true; throw e; }
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function load() {
  if (state.demo) {
    state.live = false; state.who = { label: "Demo", team: true };
    state.leads = DEMO_LEADS.map((l) => ({ ...l }));
    banner(state.noKey
      ? "Sample data only: these leads are from the September call transcripts, not real customers. Open your private link to see the studio's real leads."
      : "Demo: sample leads from the September call transcripts. Nothing here is real or saved.");
    pickDefaults();
    return render();
  }
  if (!state.key) { state.demo = true; state.noKey = true; return load(); }
  try {
    const d = await api("/leads");
    state.live = true; state.who = d.who; state.leads = d.leads;
    banner(null);
    pickDefaults();
    render();
  } catch (e) {
    if (e.locked) { try { localStorage.removeItem(KEY_STORE); } catch {} state.key = null; return locked(); }
    banner("Could not load the leads right now. Please refresh in a moment.", true);
    render();
  }
}

// Team links start on "All" (so declined and urgent leads are visible); a designer starts on "Needs action" unless it is empty.
function pickDefaults() {
  const mine = scoped();
  state.tab = state.who?.team || !mine.some(needsAction) ? "all" : "action";
}

function locked() {
  state.live = false; state.who = null; state.leads = [];
  $("stats").innerHTML = ""; $("tabs").innerHTML = ""; $("decisions").innerHTML = "";
  $("list").innerHTML = `<li class="empty"><b>This dashboard opens with a private link.</b><br>Ask the studio for your link, then open it on this device. It signs you in automatically; there is no email or password.</li>`;
  $("detail").innerHTML = "";
  $("who").textContent = "Private link needed"; $("who").className = "chip";
  $("designer").hidden = true; $("forget").hidden = true;
  banner(null);
}

async function setStage(lead, stage) {
  const prev = lead.stage;
  lead.stage = stage;
  render();
  if (!state.live) return;
  try { await api(`/leads/${encodeURIComponent(lead.id)}/stage`, { method: "POST", body: JSON.stringify({ stage }) }); }
  catch { lead.stage = prev; render(); banner("Could not save that change. Please try again.", true); }
}

// ---- view ----
function banner(msg, err = false) {
  const b = $("banner");
  b.hidden = !msg;
  b.textContent = msg || "";
  b.className = "banner" + (err ? " err" : "");
}

const isOpen = (l) => !["won", "lost", "consult_done"].includes(l.stage);
const needsAction = (l) => (l.verdict === "ESCALATION" || l.verdict === "NEEDS_REVIEW" || l.stage === "new") && isOpen(l) && l.verdict !== "UNQUALIFIED";
const upcoming = (l) => l.consult_start && new Date(l.consult_start) > new Date() && isOpen(l) && l.consult_status !== "cancelled";
const TABS = [
  ["action", "Needs action", needsAction],
  ["upcoming", "Consultations", upcoming],
  ["all", "All", () => true],
];

const scoped = () => state.leads.filter((l) => state.designer === "all" || l.designer_name === state.designer);

function visible() {
  const q = state.q.trim().toLowerCase();
  const tab = TABS.find((t) => t[0] === state.tab)[2];
  return scoped()
    .filter(tab)
    .filter((l) => state.decision === "all" || l.verdict === state.decision)
    .filter((l) => !q || [l.customer_name, l.locality, l.phone, l.property_type].join(" ").toLowerCase().includes(q))
    .sort((a, b) => (state.tab === "upcoming" ? new Date(a.consult_start) - new Date(b.consult_start) : (b.verdict === "ESCALATION") - (a.verdict === "ESCALATION") || new Date(b.created_at) - new Date(a.created_at)));
}

function render() {
  const mine = scoped();
  $("stats").innerHTML = [
    ["Need action", mine.filter(needsAction).length],
    ["Upcoming", mine.filter(upcoming).length],
    ["All leads", mine.length],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");

  $("tabs").innerHTML = TABS.map(([k, label, fn]) =>
    `<button class="tab" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${label}<span class="n">${mine.filter(fn).length}</span></button>`).join("");

  // decision filters: Selected / Needs review / Declined / Urgent (only those that exist, plus All)
  const present = new Set(mine.map((l) => l.verdict));
  $("decisions").innerHTML = state.who?.team || present.size > 1
    ? DECISIONS.filter(([k]) => k === "all" || present.has(k)).map(([k, label]) =>
        `<button class="tab" data-decision="${k}" aria-selected="${state.decision === k}">${label}<span class="n">${k === "all" ? mine.length : mine.filter((l) => l.verdict === k).length}</span></button>`).join("")
    : "";

  const rows = visible();
  // On a wide screen, open the first lead straight away so the right-hand panel is never blank.
  if (window.innerWidth > 700 && !rows.some((l) => l.id === state.selected)) state.selected = rows[0]?.id ?? null;
  $("list").innerHTML = rows.length ? rows.map(card).join("") : `<li class="empty">Nothing here right now.</li>`;
  renderDetail();

  $("who").textContent = state.live ? `${state.who?.label ?? ""} · Live` : state.noKey ? "Sample data" : "Demo";
  $("who").className = "chip" + (state.live ? " live" : "");
  const team = !!state.who?.team;
  const names = [...new Set(state.leads.map((l) => l.designer_name).filter(Boolean))];
  $("designer").hidden = !(team && names.length);
  $("designer").innerHTML = `<option value="all">All designers</option>` + names.map((d) => `<option ${state.designer === d ? "selected" : ""}>${esc(d)}</option>`).join("");
  $("forget").hidden = state.demo;
  $("who").title = state.live ? "Real leads" : "Sample data, not real customers";
}

function card(l) {
  const [vl, vc] = VERDICT[l.verdict] || [l.verdict, ""];
  const consult = l.consult_start
    ? `<span class="b ${l.consult_status === "confirmed" ? "ok" : "warn"}">${l.consult_status === "confirmed" ? "Booked" : "Pending"} · ${esc(fmtDT(l.consult_start))}</span>` : "";
  return `<li class="card" tabindex="0" role="button" data-id="${esc(l.id)}" aria-current="${state.selected === l.id}">
    <div class="r1"><span class="name">${esc(l.customer_name)}</span><span class="when">${esc(ago(l.created_at))}</span></div>
    <div class="r2">${esc([l.property_type, l.locality].filter(Boolean).join(" · "))}${l.designer_name && state.who?.team ? " · " + esc(l.designer_name) : ""}</div>
    <div class="badges"><span class="b ${vc}">${vl}</span><span class="b info">${esc(stageLabel(l.stage))}</span>${consult}</div></li>`;
}

function renderDetail() {
  const el = $("detail");
  const l = state.leads.find((x) => x.id === state.selected);
  if (!l) { el.innerHTML = `<p class="empty">Select a lead to see the full brief.</p>`; return; }
  const [vl, vc] = VERDICT[l.verdict] || [l.verdict, ""];
  const tel = (l.phone || "").replace(/[^\d+]/g, "");
  const crit = (l.criteria || []).map((c) =>
    `<li><span class="dot ${esc(c.status)}">${c.status === "pass" ? "✓" : c.status === "fail" ? "✕" : "?"}</span><span><b>${esc(c.label)}.</b> ${esc(c.reason)}</span></li>`).join("");
  const mins = l.call_duration_sec ? `${Math.floor(l.call_duration_sec / 60)}m ${l.call_duration_sec % 60}s` : "—";
  const meet = safeUrl(l.meet_link), hub = safeUrl(l.hubspot_url);
  const consult = l.consult_start
    ? `<dl class="kv"><dt>When</dt><dd>${esc(fmtDT(l.consult_start))} (IST)</dd>
       <dt>Type</dt><dd>${l.consult_mode === "online" ? "Online meeting" : "Site visit"}</dd>
       <dt>Where</dt><dd>${l.consult_mode === "online" ? (meet ? `<a href="${esc(meet)}" target="_blank" rel="noopener">Meeting link</a>` : "Link in the calendar entry") : esc(l.consult_location || "Address to confirm")}</dd>
       <dt>Status</dt><dd>${l.consult_status === "confirmed" ? "Booked on the calendar. The customer has not been told it is confirmed." : l.consult_status === "cancelled" ? "Cancelled" : "Requested, not on the calendar yet."}</dd></dl>`
    : `<p class="hint">No appointment yet.</p>`;

  el.innerHTML = `
    <button class="ghost back" id="back">← All leads</button>
    <h2>${esc(l.customer_name)}</h2>
    <p class="sub"><span class="b ${vc}">${vl}</span> &nbsp;${esc([l.property_type, l.locality, l.city].filter(Boolean).join(" · "))}</p>
    <div class="actions">
      ${tel ? `<a class="btn primary" href="tel:${esc(tel)}">Call ${esc(l.phone)}</a>` : ""}
      ${l.email ? `<a class="btn" href="mailto:${esc(l.email)}">Email</a>` : ""}
      ${hub ? `<a class="btn" href="${esc(hub)}" target="_blank" rel="noopener">Open in HubSpot</a>` : ""}
    </div>
    <div class="sec"><h3>Call summary</h3><p class="summary">${esc(l.summary || "Summary not available.")}</p></div>
    ${l.notes?.length ? `<div class="sec"><h3>Watch out for</h3><ul class="crit">${l.notes.map((n) => `<li><span class="dot unclear">!</span><span>${esc(n)}</span></li>`).join("")}</ul></div>` : ""}
    <div class="sec"><h3>Project</h3><dl class="kv">
      <dt>Requirements</dt><dd>${esc(l.requirements || "Not given")}</dd>
      <dt>Type</dt><dd>${esc(l.segment === "commercial" ? "Commercial" : "Residential")} · ${esc(l.property_type || "—")}</dd>
      <dt>Carpet area</dt><dd>${l.area_sqft ? esc(l.area_sqft) + " sq ft" : "Not given"}</dd>
      <dt>Timeline</dt><dd>${esc(l.deadline_text || "Not given")}</dd></dl></div>
    <div class="sec"><h3>Appointment</h3>${consult}</div>
    ${crit ? `<div class="sec"><h3>${l.verdict === "UNQUALIFIED" ? "Why this was declined" : "Why this was selected"}</h3><ul class="crit">${crit}</ul>${l.explanation ? `<p class="hint">${esc(l.explanation)}</p>` : ""}</div>` : ""}
    <div class="sec"><h3>Contact</h3><dl class="kv">
      <dt>Phone</dt><dd>${esc(l.phone || "—")}</dd><dt>Email</dt><dd>${esc(l.email || "Not captured")}</dd>
      <dt>Designer</dt><dd>${esc(l.designer_name || "Unassigned")}</dd>
      <dt>Call length</dt><dd>${mins}</dd><dt>Designer email</dt><dd>${esc(l.email_status || "—")}</dd></dl></div>
    <div class="sec"><h3>Your progress</h3><div class="stage">
      <label class="sr" for="stage">Stage</label>
      <select id="stage">${STAGES.map(([k, v]) => `<option value="${k}" ${k === l.stage ? "selected" : ""}>${v}</option>`).join("")}</select>
      <span class="hint">${state.live ? "Saved automatically." : "Demo: changes are not saved."}</span></div></div>`;
}

// ---- events ----
function select(id) { state.selected = id; document.body.classList.add("show-detail"); render(); }
$("list").addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) select(c.dataset.id); });
$("list").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".card")) { e.preventDefault(); select(e.target.dataset.id); } });
$("tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) { state.tab = t.dataset.tab; render(); } });
$("decisions").addEventListener("click", (e) => { const t = e.target.closest("[data-decision]"); if (t) { state.decision = t.dataset.decision; render(); } });
$("search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("detail").addEventListener("click", (e) => { if (e.target.id === "back") document.body.classList.remove("show-detail"); });
$("detail").addEventListener("change", (e) => { if (e.target.id === "stage") setStage(state.leads.find((x) => x.id === state.selected), e.target.value); });
$("designer").addEventListener("change", (e) => { state.designer = e.target.value; state.selected = null; render(); });
$("forget").addEventListener("click", () => { try { localStorage.removeItem(KEY_STORE); } catch {} state.key = null; locked(); });

initAccess();
load();
