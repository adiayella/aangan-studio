import { API_URL, STAGES } from "./config.js";
import { DEMO_LEADS, DESIGNERS } from "./demo-data.js";
import { signIn, signOut, stored, refresh } from "./auth.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const TZ = "Asia/Kolkata";

const state = { leads: [], tab: "action", q: "", selected: null, designer: "all", live: false, token: null };
state.token = stored()?.jwt || null;

const VERDICT = {
  QUALIFIED: ["Qualified", "ok"], NEEDS_REVIEW: ["Needs review", "warn"],
  ESCALATION: ["Urgent", "bad"], UNQUALIFIED: ["Not a fit", ""],
};
const fmtDT = (iso) => new Date(iso).toLocaleString("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
const stageLabel = (k) => (STAGES.find((s) => s[0] === k) || [k, k])[1];

// ---- data layer: Neon Data API (PostgREST) when a token is set, demo data otherwise ----
async function api(path, opts = {}, retried = false) {
  const r = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (r.status === 401 && !retried) {
    const s = await refresh();
    if (s) { state.token = s.jwt; return api(path, opts, true); }
  }
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

async function load() {
  if (state.token) {
    try {
      state.leads = await api("/designer_leads?select=*&order=created_at.desc&limit=200");
      state.live = true;
      banner(null);
    } catch (e) {
      state.live = false;
      state.leads = DEMO_LEADS.map((l) => ({ ...l }));
      banner(`Could not load live data (${e.message}). Showing demo data instead.`, true);
    }
  } else {
    state.live = false;
    state.leads = DEMO_LEADS.map((l) => ({ ...l }));
    banner("Demo mode: these are sample leads from the September call transcripts. Click Sign in to use the live database.");
  }
  render();
}

async function setStage(lead, stage) {
  const prev = lead.stage;
  lead.stage = stage;
  render();
  if (!state.live) return;
  try {
    await api(`/enquiries?id=eq.${encodeURIComponent(lead.id)}`, { method: "PATCH", body: JSON.stringify({ stage }), headers: { Prefer: "return=minimal" } });
  } catch (e) {
    lead.stage = prev;
    render();
    banner(`Could not save the change (${e.message}).`, true);
  }
}

// ---- view ----
function banner(msg, err = false) {
  const b = $("banner");
  b.hidden = !msg;
  b.textContent = msg || "";
  b.className = "banner" + (err ? " err" : "");
}

const isOpen = (l) => !["won", "lost", "consult_done"].includes(l.stage);
const needsAction = (l) => (l.verdict === "ESCALATION" || l.verdict === "NEEDS_REVIEW" || l.stage === "new") && isOpen(l);
const upcoming = (l) => l.consult_start && new Date(l.consult_start) > new Date() && isOpen(l);
const TABS = [
  ["action", "Needs action", needsAction],
  ["upcoming", "Consultations", upcoming],
  ["all", "All", () => true],
];

function visible() {
  const q = state.q.trim().toLowerCase();
  const tab = TABS.find((t) => t[0] === state.tab)[2];
  return state.leads
    .filter((l) => state.designer === "all" || l.designer_name === state.designer)
    .filter(tab)
    .filter((l) => !q || [l.customer_name, l.locality, l.phone, l.property_type].join(" ").toLowerCase().includes(q))
    .sort((a, b) => (state.tab === "upcoming" ? new Date(a.consult_start) - new Date(b.consult_start) : (b.verdict === "ESCALATION") - (a.verdict === "ESCALATION") || new Date(b.created_at) - new Date(a.created_at)));
}

function render() {
  const mine = state.leads.filter((l) => state.designer === "all" || l.designer_name === state.designer);
  $("stats").innerHTML = [
    ["Need action", mine.filter(needsAction).length],
    ["Upcoming", mine.filter(upcoming).length],
    ["Won", mine.filter((l) => l.stage === "won").length],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");

  $("tabs").innerHTML = TABS.map(([k, label, fn]) =>
    `<button class="tab" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${label}<span class="n">${mine.filter(fn).length}</span></button>`).join("");

  const rows = visible();
  $("list").innerHTML = rows.length
    ? rows.map(card).join("")
    : `<li class="empty">Nothing here right now.</li>`;
  renderDetail();
  const m = $("mode");
  m.textContent = state.live ? "Live" : "Demo";
  m.className = "chip" + (state.live ? " live" : "");
  $("connect").textContent = state.token ? "Sign out" : "Sign in";
}

function card(l) {
  const [vl, vc] = VERDICT[l.verdict] || [l.verdict, ""];
  const consult = l.consult_start
    ? `<span class="b ${l.consult_status === "confirmed" ? "ok" : "warn"}">${l.consult_status === "confirmed" ? "Booked" : "Pending"} · ${esc(fmtDT(l.consult_start))}</span>` : "";
  return `<li class="card" tabindex="0" role="button" data-id="${esc(l.id)}" aria-current="${state.selected === l.id}">
    <div class="r1"><span class="name">${esc(l.customer_name)}</span><span class="when">${esc(ago(l.created_at))}</span></div>
    <div class="r2">${esc([l.property_type, l.locality].filter(Boolean).join(" · "))}</div>
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
       <dt>Where</dt><dd>${l.consult_mode === "online" ? (meet ? `<a href="${esc(meet)}">Google Meet link</a>` : "Link sent with the invite") : esc(l.consult_location || "Address to confirm")}</dd>
       <dt>Status</dt><dd>${l.consult_status === "confirmed" ? "Confirmed in Google Calendar" : "Pending confirmation. Not yet on the calendar."}</dd></dl>`
    : `<p class="hint">No consultation booked yet.</p>`;

  el.innerHTML = `
    <button class="ghost back" id="back">← All leads</button>
    <h2>${esc(l.customer_name)}</h2>
    <p class="sub"><span class="b ${vc}">${vl}</span> &nbsp;${esc([l.property_type, l.locality, l.city].filter(Boolean).join(" · "))}</p>
    <div class="actions">
      ${tel ? `<a class="btn primary" href="tel:${esc(tel)}">Call ${esc(l.phone)}</a>` : ""}
      ${l.email ? `<a class="btn" href="mailto:${esc(l.email)}">Email</a>` : ""}
      ${hub && hub !== "#" ? `<a class="btn" href="${esc(hub)}" target="_blank" rel="noopener">Open in HubSpot</a>` : ""}
    </div>
    <div class="sec"><h3>Call summary</h3><p class="summary">${esc(l.summary)}</p></div>
    ${l.notes?.length ? `<div class="sec"><h3>Watch out for</h3><ul class="crit">${l.notes.map((n) => `<li><span class="dot unclear">!</span><span>${esc(n)}</span></li>`).join("")}</ul></div>` : ""}
    <div class="sec"><h3>Project</h3><dl class="kv">
      <dt>Requirements</dt><dd>${esc(l.requirements)}</dd>
      <dt>Type</dt><dd>${esc(l.segment === "commercial" ? "Commercial" : "Residential")} · ${esc(l.property_type || "—")}</dd>
      <dt>Carpet area</dt><dd>${l.area_sqft ? esc(l.area_sqft) + " sq ft" : "Not given"}</dd>
      <dt>Timeline</dt><dd>${esc(l.deadline_text || "Not given")}</dd></dl></div>
    <div class="sec"><h3>Consultation</h3>${consult}</div>
    ${crit ? `<div class="sec"><h3>Why this was passed to you</h3><ul class="crit">${crit}</ul></div>` : ""}
    <div class="sec"><h3>Contact</h3><dl class="kv">
      <dt>Phone</dt><dd>${esc(l.phone || "—")}</dd><dt>Email</dt><dd>${esc(l.email || "Not captured")}</dd>
      <dt>Call length</dt><dd>${mins}</dd><dt>Handoff email</dt><dd>${esc(l.email_status || "—")}</dd></dl></div>
    <div class="sec"><h3>Your progress</h3><div class="stage">
      <label class="sr" for="stage">Stage</label>
      <select id="stage">${STAGES.map(([k, v]) => `<option value="${k}" ${k === l.stage ? "selected" : ""}>${v}</option>`).join("")}</select>
      <span class="hint">${state.live ? "Saved to the database." : "Demo mode: changes are not saved."}</span></div></div>`;
}

// ---- events ----
function select(id) { state.selected = id; document.body.classList.add("show-detail"); render(); }
$("list").addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) select(c.dataset.id); });
$("list").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".card")) { e.preventDefault(); select(e.target.dataset.id); } });
$("tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) { state.tab = t.dataset.tab; render(); } });
$("search").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("detail").addEventListener("click", (e) => { if (e.target.id === "back") { document.body.classList.remove("show-detail"); } });
$("detail").addEventListener("change", (e) => {
  if (e.target.id === "stage") setStage(state.leads.find((x) => x.id === state.selected), e.target.value);
});
$("designer").addEventListener("change", (e) => { state.designer = e.target.value; state.selected = null; render(); });
$("connect").addEventListener("click", () => {
  if (state.token) { signOut(); state.token = null; state.selected = null; load(); return; }
  $("authErr").hidden = true; $("dlg").showModal();
});
$("cancel").addEventListener("click", () => $("dlg").close());
$("dlgForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const go = $("go"); go.disabled = true; go.textContent = "Signing in…";
  try {
    const s = await signIn($("email").value.trim(), $("password").value);
    state.token = s.jwt; $("password").value = ""; $("dlg").close(); await load();
  } catch (err) {
    $("authErr").textContent = err.message; $("authErr").hidden = false;
  } finally { go.disabled = false; go.textContent = "Sign in"; }
});

$("designer").innerHTML = `<option value="all">All designers</option>` + DESIGNERS.map((d) => `<option>${esc(d)}</option>`).join("");
load();
