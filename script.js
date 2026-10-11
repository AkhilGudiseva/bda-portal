const API_URL = "https://script.google.com/macros/s/AKfycbxGx8gdHwbW_HtZGObfJrd8-M1RIXER1hte5hGIPXmVqgpBtMmBdoKupwjB17hS30qnYg/exec";
let currentUser = null;

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const isMgr = u => ["manager", "admin"].includes(String(u && u.role).toLowerCase());

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Reads a field regardless of header style: Lead_ID, "Lead ID", leadId, lead_id ...
function pick(row, keys, fallback = "") {
  if (!row) return fallback;
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const map = {};
  Object.keys(row).forEach(k => { map[norm(k)] = row[k]; });
  for (const k of keys) {
    const v = map[norm(k)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return fallback;
}
const getLeadId  = r => pick(r, ["Lead_ID", "Lead ID", "leadId"]);
const getPartner = r => pick(r, ["Partner_Name", "Partner Name", "partnerName"]);
const getPhone   = r => pick(r, ["Phone", "Phone Number", "Phone_Number"]);
const getWalkin  = r => pick(r, ["Walkin_Date", "Walkin Date", "expectedWalkinDate", "walkinDate", "Timestamp", "Date"]);
const getBda     = r => String(pick(r, ["BDA_ID", "BDA ID", "bdaId"])).trim();
const getPrStat  = r => pick(r, ["PR_Status", "PR Status", "status"]);
const getPrDate  = r => pick(r, ["PR_Date", "PR Date", "Walkin_Date", "Walkin Date", "Timestamp", "Date"]);
const isYes = v => String(v).trim().toLowerCase() === "yes";

function parseDate(val) {
  if (!val || val === "-") return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;

  const str = String(val).trim();
  if (!str) return null;

  // Handle DD/MM/YYYY or DD-MM-YYYY format
  const ddmmyyyy = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (ddmmyyyy) {
    const day = parseInt(ddmmyyyy[1], 10);
    const month = parseInt(ddmmyyyy[2], 10) - 1; // 0-indexed month
    const year = parseInt(ddmmyyyy[3], 10);
    const parsed = new Date(year, month, day);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // Handle YYYY-MM-DD format
  const yyyymmdd = str.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (yyyymmdd) {
    const year = parseInt(yyyymmdd[1], 10);
    const month = parseInt(yyyymmdd[2], 10) - 1;
    const day = parseInt(yyyymmdd[3], 10);
    const parsed = new Date(year, month, day);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // Standard fallback
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;

}

function fmtDate(v) {
  const d = parseDate(v);
  return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : (v || "-");
}
function startOfWeek() { // Monday
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function showStatus(msg, type = "error") {
  const b = $("status-banner");
  if (!msg) { b.classList.add("hidden"); return; }
  const styles = {
    error: "bg-red-50 border-red-200 text-red-700",
    success: "bg-green-50 border-green-200 text-green-700",
    info: "bg-amber-50 border-amber-200 text-amber-800"
  };
  b.className = `mb-6 p-4 rounded-xl border text-sm font-medium ${styles[type]}`;
  b.textContent = msg;
}
function setBody(id, cols, msg, cls = "text-gray-500") {
  const el = $(id);
  if (el) el.innerHTML = `<tr><td colspan="${cols}" class="px-6 py-4 text-center ${cls}">${esc(msg)}</td></tr>`;
}

/* ---------- tabs ---------- */
function switchTab(tabName) {
  document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
  const target = $("tab-" + tabName);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll("aside button").forEach(btn => {
    btn.classList.remove("bg-blue-50", "text-blue-600", "bg-purple-50", "text-purple-700", "font-semibold");
    btn.classList.add("text-gray-600");
  });
  const active = $("nav-" + tabName);
  if (active) {
    active.classList.remove("text-gray-600");
    active.classList.add("font-semibold", ...(tabName === "manager" ? ["bg-purple-50", "text-purple-700"] : ["bg-blue-50", "text-blue-600"]));
  }
}

/* ---------- session ---------- */
document.addEventListener("DOMContentLoaded", () => {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem("bda_user")); } catch (e) {}
  if (stored && stored.userId) { currentUser = stored; showDashboard(currentUser); }
  else showLoginModal();
});

function showLoginModal() {
  $("login-view").classList.remove("hidden");
  $("app-view").classList.add("hidden");
}

function showDashboard(user) {
  $("login-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  $("user-display-name").textContent = user.name || user.userId;
  $("user-display-role").textContent = `Role: ${String(user.role).toUpperCase()}`;

  const mgr = isMgr(user);
$("nav-manager").classList.toggle("hidden", !mgr);
$("lead-bda").classList.toggle("hidden", !mgr);
$("lead-hint").textContent = mgr
  ? "Leave BDA ID empty to log the lead under your own ID."
  : `This lead will be logged under ${user.userId}.`;

  switchTab("leads");
  loadDashboardData(user);
}

function handleLogin(event) {
  event.preventDefault();
  const userId = $("login-userid").value.trim();
  const pass = $("login-pass").value.trim();
  const manager = userId.toLowerCase().includes("manager") || userId.toLowerCase().startsWith("mgr") || pass.toLowerCase().includes("admin") || pass.toLowerCase().includes("manager");
  currentUser = { userId, role: manager ? "manager" : "bda", name: userId };
  localStorage.setItem("bda_user", JSON.stringify(currentUser));
  $("login-form").reset();
  showDashboard(currentUser);
}

function logout() {
  localStorage.removeItem("bda_user");
  currentUser = null;
  showStatus("");
  showLoginModal();
}

function refreshData() { if (currentUser) loadDashboardData(currentUser); }

/* ---------- data loading ---------- */
function loadDashboardData(user) {
  if (!API_URL || API_URL === "YOUR_APPS_SCRIPT_WEB_APP_URL_HERE") {
    showStatus("API_URL is not configured in script.js.");
    return;
  }
  showStatus("");
  setBody("leads-table-body", 5, "Loading leads...");
  setBody("pr-table-body", 4, "Loading PR entries...");
  setBody("training-table-body", 5, "Loading training records...");

  const url = `${API_URL}?action=getData&userId=${encodeURIComponent(user.userId)}&role=${encodeURIComponent(user.role)}`;

  fetch(url)
    .then(res => res.text())
    .then(text => {
      let data;
      try { data = JSON.parse(text); }
      catch (e) {
        throw new Error("Backend did not return JSON. Check the Apps Script deployment: Execute as 'Me', access 'Anyone', and redeploy as a New version.");
      }
      console.log("API response:", data);

      if (!data.success) {
        const msg = data.message || data.error || "Backend returned success:false for this user.";
        showStatus(`Could not load data for ${user.userId}: ${msg}`);
        setBody("leads-table-body", 5, msg, "text-red-600");
        setBody("pr-table-body", 4, msg, "text-red-600");
        setBody("training-table-body", 4, msg, "text-red-600");
        return;
      }

      const leads = data.leads || [], pr = data.pr || [], training = data.training || [];
      // super ra bittu
      const selectedTimeframe = $("timeframe-select") ? $("timeframe-select").value : "this_week";

      const filteredLeads = filterRecordsByTimeframe(leads, getWalkin, selectedTimeframe);
      const filteredPR = filterRecordsByTimeframe(pr, getPrDate, selectedTimeframe);
      const filteredTraining = filterRecordsByTimeframe(training, getWalkin, selectedTimeframe);

      renderLeadsTable(filteredLeads);
      renderPRTable(filteredPR, user);
      renderTrainingTable(filteredTraining);
      calculateLeaderboard(filteredLeads, filteredPR, filteredTraining);

      if (isMgr(user)) {
        renderManagerOverview(filteredLeads, filteredPR, filteredTraining);
      }

      if (isMgr(user) && leads.length === 0) {
        showStatus("Logged in as manager but the backend returned 0 leads. In Apps Script, make getData return all rows when role is 'manager' (do not filter by userId), then redeploy as a New version.", "info");
      }
    })
    .catch(err => {
      console.error("Error fetching data:", err);
      showStatus(`Could not reach the backend: ${err.message}`);
      setBody("leads-table-body", 5, "Failed to load data", "text-red-600");
    });
}

/* ---------- add lead ---------- */
function submitLead(event) {
  event.preventDefault();
  if (!currentUser) return;
  const btn = $("lead-submit");
  const payload = {
    action: "addLead",
    userId: currentUser.userId,
    role: currentUser.role,
    partnerName: $("lead-partner").value.trim(),
    phone: $("lead-phone").value.trim(),
    walkinDate: $("lead-date").value,
    bdaId: isMgr(currentUser) ? ($("lead-bda").value.trim() || currentUser.userId) : currentUser.userId
  };

  btn.disabled = true; btn.textContent = "Adding...";
  fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight with Apps Script
    body: JSON.stringify(payload)
  })
    .then(r => r.text())
    .then(text => {
      let res;
      try { res = JSON.parse(text); } catch (e) { throw new Error("Backend did not return JSON. Add doPost to Apps Script and redeploy as a New version."); }
      if (!res.success) throw new Error(res.message || "Backend rejected the lead.");
      $("lead-form").reset();
      showStatus(`Lead added${res.leadId ? " (" + res.leadId + ")" : ""}.`, "success");
      loadDashboardData(currentUser);
    })
    .catch(err => showStatus(`Could not add lead: ${err.message}`))
    .finally(() => { btn.disabled = false; btn.textContent = "Add lead"; });
}

/* ---------- renderers ---------- */
function renderLeadsTable(leadsData) {
  const valid = (leadsData || []).filter(r => String(getLeadId(r)).trim() !== "" || String(getPartner(r)).trim() !== "");
  if (!valid.length) return setBody("leads-table-body", 5, "No lead entries found");

  $("leads-table-body").innerHTML = valid.map(r => `
    <tr class="hover:bg-gray-50">
      <td class="px-6 py-4 font-mono text-xs">${esc(getLeadId(r) || "-")}</td>
      <td class="px-6 py-4 font-medium text-gray-900">${esc(getPartner(r) || "-")}</td>
      <td class="px-6 py-4 text-gray-500">${esc(getPhone(r) || "-")}</td>
      <td class="px-6 py-4 text-gray-500">${esc(fmtDate(getWalkin(r)))}</td>
      <td class="px-6 py-4 font-semibold text-blue-600">${esc(getBda(r) || "-")}</td>
    </tr>`).join("");
}

function renderPRTable(prData, user) {
  const valid = (prData || []).filter(r => String(getLeadId(r)).trim() !== "");
  const me = String(user.userId).trim().toLowerCase();
  const teamPR = valid.filter(r => isYes(getPrStat(r))).length;
  const myPR = valid.filter(r => getBda(r).toLowerCase() === me && isYes(getPrStat(r))).length;
  $("team-pr-counter").textContent = `${teamPR}/40`;
  $("bda-pr-counter").textContent = `${myPR}/4`;

  if (!valid.length) return setBody("pr-table-body", 4, "No PR records found");
  $("pr-table-body").innerHTML = valid.map(r => {
    const status = getPrStat(r) || "Pending";
    const badge = isYes(status) ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800";
    return `
    <tr class="hover:bg-gray-50">
      <td class="px-6 py-4 font-mono text-xs">${esc(getLeadId(r))}</td>
      <td class="px-6 py-4 font-medium text-gray-900">${esc(getPartner(r) || "-")}</td>
      <td class="px-6 py-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${badge}">${esc(status)}</span></td>
      <td class="px-6 py-4 text-gray-500">${esc(fmtDate(getPrDate(r)))}</td>
    </tr>`;
  }).join("");
}

function renderTrainingTable(trainingData) {
  const valid = (trainingData || []).filter(r => String(getLeadId(r)).trim() !== "");
  if (!valid.length) return setBody("training-table-body", 5, "No training records found");
  $("training-table-body").innerHTML = valid.map(r => {
    const att = String(pick(r, ["Training_Attended", "Training Attended", "Attended"], "No"));
    const pas = String(pick(r, ["Training_Passed", "Training Passed", "Passed"], "No"));
    return `
    <tr class="hover:bg-gray-50">
      <td class="px-6 py-4 font-mono text-xs">${esc(getLeadId(r))}</td>
      <td class="px-6 py-4 font-medium text-gray-900">${esc(getPartner(r) || "-")}</td>
      <td class="px-6 py-4 font-semibold text-blue-600">${esc(getBda(r) || "-")}</td>
      <td class="px-6 py-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${isYes(att) ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}">${esc(att)}</span></td>
      <td class="px-6 py-4"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${isYes(pas) ? "bg-indigo-100 text-indigo-800" : "bg-gray-100 text-gray-800"}">${esc(pas)}</span></td>
    </tr>`;
  }).join("");
}

function calculateLeaderboard(leads, pr, training) {
  // Helper function to count and rank ALL BDAs in descending order
  const getFullRankings = arr => {
    const counts = {};
    (arr || []).forEach(r => {
      const id = getBda(r);
      if (id && id !== "-" && id.toLowerCase() !== "unknown") {
        counts[id] = (counts[id] || 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };

  // 1. Calculate rankings using the filtered leads passed into this function
  const leadsRank = getFullRankings(leads);
  const prRank = getFullRankings(pr.filter(r => isYes(getPrStat(r))));
  const trainingRank = getFullRankings(training.filter(r => isYes(pick(r, ["Training_Passed", "Training Passed", "Passed"]))));

  // 2. Update Sidebar Leaderboard Summary Widgets (Top #1 BDA)
  if ($("leader-leads")) $("leader-leads").textContent = leadsRank.length ? `${leadsRank[0][0]} (${leadsRank[0][1]})` : "No data";
  if ($("leader-pr")) $("leader-pr").textContent = prRank.length ? `${prRank[0][0]} (${prRank[0][1]})` : "No data";
  if ($("leader-training")) $("leader-training").textContent = trainingRank.length ? `${trainingRank[0][0]} (${trainingRank[0][1]})` : "No data";

  // 3. Render Leaderboard Tab Cards for all BDAs
  const renderList = (elementId, rankings, unitLabel) => {
    const container = $(elementId);
    if (!container) return;

    if (!rankings || rankings.length === 0) {
      container.innerHTML = `<p class="text-gray-400 text-sm italic py-2 text-center">No activity recorded for selected timeframe</p>`;
      return;
    }

    container.innerHTML = rankings.map(([bda, count], index) => {
      let bgStyle = "bg-white border border-gray-100 hover:bg-gray-50";
      let medal = "";

      if (index === 0) {
        bgStyle = "bg-amber-50/60 border border-amber-200/80 font-semibold";
        medal = "🥇 ";
      } else if (index === 1) {
        bgStyle = "bg-gray-50 border border-gray-200 font-medium";
        medal = "🥈 ";
      } else if (index === 2) {
        bgStyle = "bg-amber-900/5 border border-amber-800/10 font-medium";
        medal = "🥉 ";
      }

      return `
        <div class="flex justify-between items-center p-3 rounded-xl transition ${bgStyle}">
          <span class="flex items-center space-x-2.5">
            <span class="text-xs font-bold text-gray-400 w-5">#${index + 1}</span>
            <span class="text-gray-800 text-sm font-medium">${medal}${esc(bda)}</span>
          </span>
          <span class="text-xs font-bold px-2.5 py-1 bg-white/80 rounded-lg text-blue-600 border border-gray-100 shadow-2xs">
            ${count} ${unitLabel}
          </span>
        </div>
      `;
    }).join("");
  };

  renderList("leaderboard-leads-list", leadsRank, "leads");
  renderList("leaderboard-pr-list", prRank, "PRs");
  renderList("leaderboard-training-list", trainingRank, "passed");
}

function renderManagerOverview(leads, pr, training) {
  const validLeads = (leads || []).filter(r => String(getLeadId(r)).trim() !== "");
  const okPR = (pr || []).filter(r => isYes(getPrStat(r)));
  const okTr = (training || []).filter(r => isYes(pick(r, ["Training_Passed", "Training Passed", "Passed"])));
  const pct = (a, b) => b ? ((a / b) * 100).toFixed(1) + "%" : "0%";

  const wk = startOfWeek(), todayStr = new Date().toDateString();
  const isToday = r => { const d = parseDate(getWalkin(r)); return d && d.toDateString() === todayStr; };
  const isWeek = r => { const d = parseDate(getWalkin(r)); return d && d >= wk; };

  $("mgr-leads-timeframe").textContent = `${validLeads.filter(isToday).length} / ${validLeads.filter(isWeek).length}`;
  $("mgr-total-prs").textContent = okPR.length;
  $("mgr-team-lead-pr-ratio").textContent = pct(okPR.length, validLeads.length);
  $("mgr-team-pr-training-ratio").textContent = pct(okTr.length, okPR.length);

  const map = {};
  const row = id => (map[id] = map[id] || { leads: 0, wk: 0, day: 0, prs: 0, tr: 0 });
  validLeads.forEach(r => { const s = row(getBda(r) || "Unknown"); s.leads++; if (isWeek(r)) s.wk++; if (isToday(r)) s.day++; });
  okPR.forEach(r => row(getBda(r) || "Unknown").prs++);
  okTr.forEach(r => row(getBda(r) || "Unknown").tr++);

  const entries = Object.entries(map);
  if (!entries.length) return setBody("manager-breakdown-tbody", 6, "No data available");
  $("manager-breakdown-tbody").innerHTML = entries.map(([bda, s]) => `
    <tr class="hover:bg-gray-50">
      <td class="px-6 py-4 font-semibold text-blue-600">${esc(bda)}</td>
      <td class="px-6 py-4">${s.wk} / ${s.day} <span class="text-xs text-gray-400">(total ${s.leads})</span></td>
      <td class="px-6 py-4 text-green-600">${s.prs}</td>
      <td class="px-6 py-4 text-indigo-600">${s.tr}</td>
      <td class="px-6 py-4"><span class="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold">${pct(s.prs, s.leads)}</span></td>
      <td class="px-6 py-4"><span class="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold">${pct(s.tr, s.prs)}</span></td>
    </tr>`).join("");
}
/* ---------- TIMEFRAME HELPER ---------- */
/* ---------- ROBUST TIMEFRAME HELPER ---------- */
function getTimeframeCutoff(option) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Get Monday of current week
  const startCurrentWeek = new Date(now);
  const day = startCurrentWeek.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  startCurrentWeek.setDate(startCurrentWeek.getDate() + diff);

  if (option === "this_week") {
    return { start: startCurrentWeek, end: null };
  } else if (option === "last_week") {
    const startLastWeek = new Date(startCurrentWeek);
    startLastWeek.setDate(startLastWeek.getDate() - 7);
    return { start: startLastWeek, end: startCurrentWeek };
  } else if (option === "2_weeks_ago") {
    const start2WeeksAgo = new Date(startCurrentWeek);
    start2WeeksAgo.setDate(start2WeeksAgo.getDate() - 14);
    const startLastWeek = new Date(startCurrentWeek);
    startLastWeek.setDate(startLastWeek.getDate() - 7);
    return { start: start2WeeksAgo, end: startLastWeek };
  } else if (option === "3_weeks_ago") {
    const start3WeeksAgo = new Date(startCurrentWeek);
    start3WeeksAgo.setDate(start3WeeksAgo.getDate() - 21);
    return { start: start3WeeksAgo, end: null };
  }
  return { start: null, end: null };
}

function filterRecordsByTimeframe(records, dateExtractor, timeframeOption) {
  const { start, end } = getTimeframeCutoff(timeframeOption);
  if (!start && !end) return records || [];

  return (records || []).filter(r => {
    const rawVal = dateExtractor(r);
    if (!rawVal || rawVal === "-") return false;

    const d = parseDate(rawVal);
    if (!d) return false;

    d.setHours(0, 0, 0, 0);

    if (start && d < start) return false;
    if (end && d >= end) return false;
    return true;
  });
}

function filterRecordsByTimeframe(records, dateExtractor, timeframeOption) {
  const { start, end } = getTimeframeCutoff(timeframeOption);
  if (!start && !end) return records;

  return (records || []).filter(r => {
    const d = parseDate(dateExtractor(r));
    if (!d) return true; // Keep records without strict dates if needed
    if (start && d < start) return false;
    if (end && d >= end) return false;
    return true;
  });
}

function handleTimeframeChange() {
  if (currentUser) {
    loadDashboardData(currentUser);
  }
}

