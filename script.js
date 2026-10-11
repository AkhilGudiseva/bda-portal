const API_URL = "https://script.google.com/macros/s/AKfycbxGx8gdHwbW_HtZGObfJrd8-M1RIXER1hte5hGIPXmVqgpBtMmBdoKupwjB17hS30qnYg/exec";
const DEF_TEAM = 40, DEF_BDA = 4;           // used until you save a target for a week
const WEEKS = 4;                            // this week + 3 previous weeks

const $ = id => document.getElementById(id);
let user = null, DB = { leads: [], pr: [], training: [], targets: [], team: [] }, L = [], P = [], T = [];
const isMgr = () => !!user && user.role === "manager";

/* ---------- small helpers ---------- */
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function pick(row, keys, fb = "") {
  const n = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const m = {}; Object.keys(row || {}).forEach(k => m[n(k)] = row[k]);
  for (const k of keys) { const v = m[n(k)]; if (v !== undefined && v !== null && String(v).trim() !== "") return v; }
  return fb;
}
const isYes = v => String(v).trim().toLowerCase() === "yes";
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "–";
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function parseDate(v) {
  if (!v || v === "-") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return new Date(+m[1], m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/))) return new Date(+m[3], m[2] - 1, +m[1]); // dd/mm/yyyy
  const d = new Date(s); return isNaN(d) ? null : d;       // handles ISO timestamps (converted to local time)
}
const fmtDate = v => { const d = parseDate(v); return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"; };

/* ---------- weeks (Monday start) ---------- */
function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const weekStart = off => { const m = mondayOf(new Date()); m.setDate(m.getDate() - 7 * off); return m; };   // 0 this, 1 last, -1 next
function weekLabel(off) {
  const s = weekStart(off), e = new Date(s); e.setDate(e.getDate() + 6);
  const f = d => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${["This week", "Last week", "2 weeks ago", "3 weeks ago"][off] || "Next week"} (${f(s)} – ${f(e)})`;
}
// Which week a date falls in: 0 = this week ... 3 = three weeks ago. Future dates count as this week.
function weekOf(v) {
  const d = parseDate(v); if (!d) return null;
  const w = Math.round((weekStart(0) - mondayOf(d)) / 604800000);
  return w < 0 ? 0 : w;
}
const sel = () => { const v = $("week-select").value; return v === "all" ? "all" : +v; };
const inW = (x, w) => w === "all" ? x.w !== null && x.w < WEEKS : x.w === w;
const periodLabel = w => w === "all" ? `Last 4 weeks (${weekLabel(3).match(/\((.*?) –/)[1]} – ${weekLabel(0).match(/– (.*)\)/)[1]})` : weekLabel(w);

/* ---------- UI helpers ---------- */
function showStatus(msg, type = "error") {
  const b = $("status-banner");
  if (!msg) return b.classList.add("hidden");
  const c = { error: "bg-red-50 border-red-200 text-red-700", success: "bg-green-50 border-green-200 text-green-700", info: "bg-amber-50 border-amber-200 text-amber-800" };
  b.className = `mb-6 p-4 rounded-xl border text-sm font-medium ${c[type]}`; b.textContent = msg;
}
const tbl = (h, r, empty = "No records for this period") => r.length
  ? `<table class="w-full text-left text-sm"><thead><tr class="bg-gray-50 text-gray-600 text-xs border-b">${h.map(x => `<th class="px-4 py-3 font-semibold">${x}</th>`).join("")}</tr></thead><tbody class="divide-y divide-gray-200">${r.join("")}</tbody></table>`
  : `<p class="p-6 text-center text-sm text-gray-500">${empty}</p>`;
const row = cells => `<tr class="hover:bg-gray-50">${cells.map(c => `<td class="px-4 py-3">${c}</td>`).join("")}</tr>`;
const badge = (t, ok) => `<span class="px-2.5 py-1 rounded-full text-xs font-semibold ${ok ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}">${esc(t)}</span>`;
const bar = p => `<div class="h-2 w-24 bg-gray-100 rounded-full inline-block align-middle mr-2"><div class="h-2 rounded-full ${p >= 100 ? "bg-green-500" : p >= 50 ? "bg-amber-400" : "bg-red-400"}" style="width:${Math.min(p, 100)}%"></div></div>`;
const nm = id => { const u = DB.team.find(t => same(t.userId, id)); return u && u.name && u.name !== id ? `${esc(u.name)} (${esc(id)})` : esc(id); };
const card = (t, v, tg) => { const p = tg ? Math.round(v / tg * 100) : 0; return `<div class="bg-white p-5 rounded-xl border border-gray-200"><p class="text-sm text-gray-500">${t}</p><p class="text-2xl font-bold mt-1">${v} <span class="text-base font-medium text-gray-400">/ ${tg}</span></p><div class="mt-2">${bar(p)}<span class="text-xs text-gray-500">${p}% of target</span></div></div>`; };

function switchTab(n) {
  document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
  $("tab-" + n).classList.remove("hidden");
  document.querySelectorAll("[data-tab]").forEach(b => {
    const on = b.dataset.tab === n;
    b.classList.toggle("bg-blue-50", on); b.classList.toggle("text-blue-600", on);
    b.classList.toggle("font-semibold", on); b.classList.toggle("text-gray-600", !on);
  });
}

/* ---------- backend ---------- */
async function api(action, extra = {}, creds = user) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },   // avoids CORS preflight
    body: JSON.stringify({ action, userId: creds.userId, pass: creds.pass, ...extra })
  });
  let data;
  try { data = JSON.parse(await res.text()); }
  catch (e) { throw new Error("Backend did not return JSON. Redeploy the Apps Script as a New version with access set to 'Anyone'."); }
  if (!data.success) throw new Error(data.message || "Request failed");
  return data;
}

/* ---------- session ---------- */
document.addEventListener("DOMContentLoaded", () => {
  try { user = JSON.parse(localStorage.getItem("bda_user")); } catch (e) { user = null; }
  user && user.userId && user.pass ? startApp() : $("login-view").classList.remove("hidden");
});

async function handleLogin(e) {
  e.preventDefault();
  const btn = $("login-btn"), err = $("login-error");
  const creds = { userId: $("login-userid").value.trim(), pass: $("login-pass").value };
  btn.disabled = true; btn.textContent = "Signing in...";
  try {
    const r = await api("login", {}, creds);
    user = { ...creds, userId: r.user.userId, role: r.user.role, name: r.user.name };
    localStorage.setItem("bda_user", JSON.stringify(user));
    err.classList.add("hidden"); $("login-pass").value = "";
    startApp();
  } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); }
  btn.disabled = false; btn.textContent = "Sign in";
}

function logout(msg) {
  localStorage.removeItem("bda_user"); user = null;
  $("app-view").classList.add("hidden"); $("login-view").classList.remove("hidden");
  const err = $("login-error"); err.textContent = msg || ""; err.classList.toggle("hidden", !msg);
}

function startApp() {
  $("login-view").classList.add("hidden"); $("app-view").classList.remove("hidden");
  $("user-display-name").textContent = user.name || user.userId;
  $("user-display-role").textContent = isMgr() ? "Manager" : `BDA · ${user.userId}`;
  document.querySelectorAll(".mgr-only").forEach(e => e.classList.toggle("hidden", !isMgr()));
  $("lead-bda").classList.toggle("hidden", !isMgr()); $("lead-bda").required = isMgr();
  $("lead-hint").textContent = isMgr() ? "Choose the BDA this lead belongs to." : `This lead will be logged under ${user.userId}.`;
  $("lead-date").value = iso(new Date());

  const opts = [0, 1, 2, 3].map(o => `<option value="${o}">${weekLabel(o)}</option>`).join("");
  $("week-select").innerHTML = opts + `<option value="all">All 4 weeks</option>`;
  $("tgt-week").innerHTML = [-1, 0, 1, 2, 3].map(o => `<option value="${o}" ${o === 0 ? "selected" : ""}>${weekLabel(o)}</option>`).join("");
  switchTab("leaderboard");
  loadData();
}

/* ---------- load + normalise ---------- */
async function loadData() {
  showStatus("");
  ["leads", "pr", "training"].forEach(t => $(t + "-view").innerHTML = `<p class="p-6 text-center text-sm text-gray-500">Loading...</p>`);
  try {
    const d = await api("getData");
    DB = { leads: d.leads || [], pr: d.pr || [], training: d.training || [], targets: d.targets || [], team: d.team || [] };
    prepare();
    if (isMgr()) {
      const keep = $("bda-filter").value, ids = DB.team.map(u => u.userId).sort();
      $("bda-filter").innerHTML = `<option value="">All BDAs</option>` + ids.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join("");
      $("bda-filter").value = ids.includes(keep) ? keep : "";
      $("lead-bda").innerHTML = `<option value="" disabled selected>Select BDA</option>` + ids.map(i => `<option value="${esc(i)}">${nm(i)}</option>`).join("");
      renderTargets();
    }
    render();
  } catch (err) {
    if (/invalid user/i.test(err.message)) return logout(err.message);
    showStatus(err.message);
    ["leads", "pr", "training"].forEach(t => $(t + "-view").innerHTML = `<p class="p-6 text-center text-sm text-red-600">Failed to load data</p>`);
  }
}

function prepare() {
  const lead = {}, prDate = {};
  L = DB.leads.map(r => ({
    id: String(pick(r, ["Lead_ID", "Lead ID", "leadId"])).trim(), partner: pick(r, ["Partner_Name", "Partner Name", "partnerName"]),
    phone: pick(r, ["Phone", "Contact", "Phone Number", "Mobile"]),
    walkin: pick(r, ["Expected_Walkin_Date", "Walkin_Date", "Walkin Date", "walkinDate"]),
    // A lead counts in the week it was LOGGED (timestamp). To count by expected walk-in date instead, swap the two lists below.
    date: pick(r, ["Timestamp", "Created_At", "Expected_Walkin_Date", "Walkin_Date", "Walkin Date", "Date"]),
    bda: String(pick(r, ["BDA_ID", "BDA ID", "bdaId"])).trim()
  })).filter(x => x.id || x.partner);
  L.forEach(x => { x.w = weekOf(x.date); lead[x.id] = x; });

  P = DB.pr.map(r => {
    const id = String(pick(r, ["Lead_ID", "Lead ID", "leadId"])).trim(), ld = lead[id] || {};
    const date = pick(r, ["PR_Date", "PR Date", "Walkin_Date", "Walkin Date", "Timestamp", "Date"]) || ld.walkin || ld.date;
    const st = pick(r, ["PR_Status", "PR Status", "status"]);
    return { id, partner: pick(r, ["Partner_Name", "Partner Name"]) || ld.partner || "", bda: String(pick(r, ["BDA_ID", "BDA ID"]) || ld.bda || "").trim(), status: st || "Pending", ok: isYes(st), date, w: weekOf(date) };
  }).filter(x => x.id);
  P.forEach(x => prDate[x.id] = x.date);

  T = DB.training.map(r => {
    const id = String(pick(r, ["Lead_ID", "Lead ID", "leadId"])).trim(), ld = lead[id] || {};
    const date = pick(r, ["Training_Date", "Training Date"]) || prDate[id] || ld.walkin || ld.date;
    const att = String(pick(r, ["Training_Attended", "Training Attended", "Attended"], "No")), pas = String(pick(r, ["Training_Passed", "Training Passed", "Passed"], "No"));
    return { id, partner: pick(r, ["Partner_Name", "Partner Name"]) || ld.partner || "", bda: String(pick(r, ["BDA_ID", "BDA ID"]) || ld.bda || "").trim(), att, pas, ok: isYes(pas), date, w: weekOf(date) };
  }).filter(x => x.id);
}

/* ---------- stats + targets ---------- */
function stats(w, bda) {
  const f = a => a.filter(x => inW(x, w) && (!bda || same(x.bda, bda))).length;
  return { leads: f(L), prs: f(P.filter(x => x.ok)), tr: f(T.filter(x => x.ok)) };
}
function targetFor(bda, off) {            // latest saved target on or before that week; falls back to the default
  const ws = iso(weekStart(off)); let best = null;
  DB.targets.forEach(t => {
    if (!same(pick(t, ["BDA_ID", "BDA ID"]), bda)) return;
    const w = String(pick(t, ["Week_Start", "Week Start"])).slice(0, 10), v = +pick(t, ["Target"], NaN);
    if (w <= ws && !isNaN(v) && (!best || w > best.w)) best = { w, v };
  });
  return best ? best.v : (same(bda, "TEAM") ? DEF_TEAM : DEF_BDA);
}
const targetSum = (bda, w) => w === "all" ? [0, 1, 2, 3].reduce((s, o) => s + targetFor(bda, o), 0) : targetFor(bda, w);
function roster() {
  const s = new Set(DB.team.map(u => u.userId)); [...L, ...P, ...T].forEach(x => x.bda && s.add(x.bda)); return [...s].sort();
}
function trendTable(bda) {                // one row per week, for one BDA or (bda = null) the whole team
  return tbl(["Week", "Leads", "PRs / target", "Achievement", "Trainings passed", "Leads → PR"], [0, 1, 2, 3].map(o => {
    const s = stats(o, bda), tg = targetFor(bda || "TEAM", o), p = tg ? Math.round(s.prs / tg * 100) : 0;
    return row([weekLabel(o), s.leads, `${s.prs} / ${tg}`, bar(p) + p + "%", s.tr, pct(s.prs, s.leads)]);
  }));
}

/* ---------- render ---------- */
function render() {
  if (!user) return;
  const w = sel(); $("period-label").textContent = periodLabel(w);
  const f = $("bda-filter").value;
  const mine = x => isMgr() ? (!f || same(x.bda, f)) : same(x.bda, user.userId);   // BDAs only see their own rows
  renderBoard(w); renderLeads(w, mine); renderPR(w, mine); renderTraining(w, mine);
  if (isMgr()) renderMgr(w);
}

function renderBoard(w) {
  const rank = a => { const c = {}; a.forEach(x => { if (x.bda && inW(x, w)) c[x.bda] = (c[x.bda] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const list = (id, r, unit) => $(id).innerHTML = r.length ? r.map(([b, n], i) => `
    <div class="flex justify-between items-center p-3 rounded-xl border ${i === 0 ? "bg-amber-50 border-amber-200 font-semibold" : "border-gray-100"} ${!isMgr() && same(b, user.userId) ? "ring-2 ring-blue-200" : ""}">
      <span class="text-sm"><span class="text-xs text-gray-400 mr-2">#${i + 1}</span>${i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}${nm(b)}</span>
      <span class="text-xs font-bold text-blue-600">${n} ${unit}</span></div>`).join("")
    : `<p class="text-gray-400 text-sm italic text-center py-2">No activity for this period</p>`;
  list("lb-leads", rank(L), "leads"); list("lb-pr", rank(P.filter(x => x.ok)), "PRs"); list("lb-tr", rank(T.filter(x => x.ok)), "passed");
}

function renderLeads(w, mine) {
  const r = L.filter(x => inW(x, w) && mine(x)).sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0));
  $("leads-view").innerHTML = tbl(["Lead ID", "Partner name", "Phone", "Walk-in date", "BDA"], r.map(x =>
    row([`<span class="font-mono text-xs">${esc(x.id || "-")}</span>`, esc(x.partner || "-"), esc(x.phone || "-"), fmtDate(x.walkin || x.date), `<span class="font-semibold text-blue-600">${esc(x.bda || "-")}</span>`])));
}

function renderPR(w, mine) {
  const teamPR = P.filter(x => x.ok && inW(x, w)).length;
  let html = `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${card("Team PRs", teamPR, targetSum("TEAM", w))}`;
  if (!isMgr()) html += card("My PRs", P.filter(x => x.ok && inW(x, w) && same(x.bda, user.userId)).length, targetSum(user.userId, w));
  $("pr-cards").innerHTML = html + "</div>";
  $("my-weeks").innerHTML = isMgr() ? "" : `<h3 class="text-sm font-bold text-gray-700 mb-2">My weekly progress</h3><div class="bg-white rounded-xl border border-gray-200 overflow-x-auto">${trendTable(user.userId)}</div>`;

  const r = P.filter(x => inW(x, w) && mine(x)).sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0));
  $("pr-view").innerHTML = tbl(["Lead ID", "Partner name", "BDA", "PR status", "PR date"], r.map(x =>
    row([`<span class="font-mono text-xs">${esc(x.id)}</span>`, esc(x.partner || "-"), esc(x.bda || "-"), badge(x.status, x.ok), fmtDate(x.date)])));
}

function renderTraining(w, mine) {
  const r = T.filter(x => inW(x, w) && mine(x));
  $("training-view").innerHTML = tbl(["Lead ID", "Partner name", "BDA", "Attended", "Passed", "Date"], r.map(x =>
    row([`<span class="font-mono text-xs">${esc(x.id)}</span>`, esc(x.partner || "-"), esc(x.bda || "-"), badge(x.att, isYes(x.att)), badge(x.pas, x.ok), fmtDate(x.date)])));
}

function renderMgr(w) {
  $("mgr-period").textContent = periodLabel(w);
  const s = stats(w, null), tgT = targetSum("TEAM", w);
  const kpi = (t, v, c = "text-gray-900") => `<div class="bg-white p-5 rounded-xl border border-gray-200"><p class="text-sm text-gray-500">${t}</p><h3 class="text-2xl font-bold mt-1 ${c}">${v}</h3></div>`;
  $("mgr-kpis").innerHTML = kpi("Leads", s.leads) + kpi("PRs vs team target", `${s.prs} / ${tgT}`, "text-green-600") + kpi("Leads → PR", pct(s.prs, s.leads), "text-blue-600") + kpi("PR → training passed", pct(s.tr, s.prs), "text-indigo-600");

  const active = new Set(DB.team.map(u => u.userId));
  const ids = roster().filter(id => active.has(id) || stats("all", id).leads + stats("all", id).prs > 0);
  const line = (label, st, tg) => { const p = tg ? Math.round(st.prs / tg * 100) : 0; return row([label, st.leads, st.prs, tg, bar(p) + p + "%", st.tr, pct(st.prs, st.leads), pct(st.tr, st.prs)]); };
  $("mgr-bda").innerHTML = tbl(["BDA", "Leads", "PRs", "PR target", "Achievement", "Trainings passed", "Leads → PR", "PR → training"],
    [...ids.map(id => line(`<span class="font-semibold text-blue-600">${nm(id)}</span>`, stats(w, id), targetSum(id, w))), line("<strong>Team</strong>", s, tgT)]);
  $("mgr-weeks").innerHTML = trendTable(null);
  $("mgr-matrix").innerHTML = tbl(["BDA", ...[0, 1, 2, 3].map(weekLabel)], ids.map(id => row([nm(id), ...[0, 1, 2, 3].map(o => {
    const st = stats(o, id), tg = targetFor(id, o);
    return `<span class="font-semibold ${st.prs >= tg ? "text-green-600" : "text-gray-800"}">${st.prs} / ${tg}</span> <span class="text-xs text-gray-400">· ${st.leads} leads</span>`;
  })])));
}

/* ---------- targets (manager) ---------- */
function renderTargets() {
  const o = +$("tgt-week").value, ids = DB.team.map(u => u.userId).sort();
  $("tgt-team").value = targetFor("TEAM", o);
  $("tgt-table").innerHTML = tbl(["BDA", "PR target", "Achieved", "Progress"], ids.map(id => {
    const a = stats(o, id).prs, tg = targetFor(id, o), p = tg ? Math.round(a / tg * 100) : 0;
    return row([nm(id), `<input type="number" min="0" class="tgt-in w-24 px-3 py-1.5 border border-gray-300 rounded-lg" data-bda="${esc(id)}" value="${tg}">`, a, bar(p) + p + "%"]);
  }), "No active BDAs yet. Add BDAs (Role = BDA) in the Users sheet.");
}
function sumTargets() { $("tgt-team").value = [...document.querySelectorAll(".tgt-in")].reduce((s, i) => s + (+i.value || 0), 0); }
async function saveTargets() {
  const o = +$("tgt-week").value, targets = {};
  document.querySelectorAll(".tgt-in").forEach(i => targets[i.dataset.bda] = Math.max(0, +i.value || 0));
  try {
    await api("setTargets", { weekStart: iso(weekStart(o)), team: Math.max(0, +$("tgt-team").value || 0), targets });
    await loadData(); showStatus(`Targets saved for ${weekLabel(o)}.`, "success");
    document.querySelector("main").scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) { showStatus(e.message); }
}

/* ---------- add lead + CSV ---------- */
async function submitLead(e) {
  e.preventDefault();
  const btn = $("lead-submit"); btn.disabled = true; btn.textContent = "Adding...";
  try {
    const r = await api("addLead", {
      partnerName: $("lead-partner").value.trim(), phone: $("lead-phone").value.trim(),
      walkinDate: $("lead-date").value, bdaId: isMgr() ? $("lead-bda").value : user.userId
    });
    const keep = $("lead-bda").value; $("lead-form").reset(); $("lead-date").value = iso(new Date()); $("lead-bda").value = keep;
    await loadData(); showStatus(`Lead added${r.leadId ? " (" + r.leadId + ")" : ""}.`, "success");
  } catch (err) { showStatus("Could not add lead: " + err.message); }
  btn.disabled = false; btn.textContent = "Add lead";
}

function exportCSV(tab) {                 // exports exactly what the table on screen shows
  const trs = [...document.querySelectorAll(`#${tab}-view tr`)];
  if (!trs.length) return showStatus("Nothing to export for this period.", "info");
  const csv = trs.map(tr => [...tr.children].map(c => `"${c.textContent.trim().replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${tab}-${iso(new Date())}.csv`; a.click();
}