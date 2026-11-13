"use strict";
const CUR = "$"; // change to your preferred currency symbol
const $ = (s) => document.querySelector(s);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TITLES = { dashboard: "Dashboard", income: "Income", expenses: "Expenses", ledger: "Ledger", reports: "Reports", savings: "Savings" };
const GREEN = "#16a864", NAVY = "#0a1f44";
const PALETTE = ["#0a1f44", "#16a864", "#2f5fa8", "#7cd6a8", "#5b7db8", "#0f8a4f", "#a9bcdc", "#3b4f73"];

const money = (n) => CUR + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const monthLabel = (ym) => MONTHS[+ym.slice(5) - 1] + " " + ym.slice(0, 4);

let page = "dashboard", charts = {}, cache = {};

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error((data && data.error) || "Request failed.");
  return data;
}
function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg; t.className = "show" + (bad ? " bad" : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ""), 2800);
}
function draw(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($("#" + id), cfg);
}
const barCfg = (rows) => ({
  type: "bar",
  data: {
    labels: rows.map((r) => MONTHS[+r.month.slice(5) - 1]),
    datasets: [
      { label: "Income", data: rows.map((r) => r.income), backgroundColor: GREEN, borderRadius: 4 },
      { label: "Expenses", data: rows.map((r) => r.expenses), backgroundColor: NAVY, borderRadius: 4 },
    ],
  },
  options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: (v) => CUR + v } } },
    plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.raw)}` } } } },
});
const pieCfg = (cats) => ({
  type: "doughnut",
  data: { labels: cats.map((c) => c.category), datasets: [{ data: cats.map((c) => c.total), backgroundColor: PALETTE, borderWidth: 2 }] },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" },
    tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.raw)}` } } } },
});

/* ---------- table rendering ---------- */
function txTable(rows, { balance = false } = {}) {
  rows.forEach((r) => (cache[r.id] = r));
  if (!rows.length) return '<p class="empty">No transactions yet. Add one or load the sample data.</p>';
  const body = rows.map((r) => `<tr>
    <td>${esc(r.date)}</td>
    <td><span class="badge ${r.type}">${esc(r.type)}</span></td>
    <td>${esc(r.category)}</td>
    <td class="desc">${esc(r.description)}</td>
    <td class="num ${r.type === "income" ? "pos" : "neg"}">${r.type === "income" ? "+" : "-"}${money(r.amount)}</td>
    ${balance ? `<td class="num">${money(r.balance)}</td>` : ""}
    <td class="row-actions"><button data-edit="${r.id}">Edit</button><button class="del" data-del="${r.id}">Delete</button></td></tr>`).join("");
  return `<table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th class="num">Amount</th>${balance ? '<th class="num">Balance</th>' : ""}<th></th></tr></thead><tbody>${body}</tbody></table>`;
}
const sum = (rows) => rows.reduce((a, r) => a + r.amount, 0);

/* ---------- page loaders ---------- */
async function loadDashboard() {
  const [s, recent, exp] = await Promise.all([api("/api/summary"), api("/api/transactions?limit=8"), api("/api/reports")]);
  $("#c-income").textContent = money(s.income);
  $("#c-expenses").textContent = money(s.expenses);
  $("#c-balance").textContent = money(s.balance);
  $("#c-savings").textContent = money(s.savings);
  $("#d-goalname").textContent = s.goal.name;
  $("#d-bar").style.width = s.progress + "%";
  $("#d-pct").textContent = s.progress + "%";
  $("#d-goaltext").textContent = `${money(s.savings)} of ${money(s.goal.target)}`;
  $("#recent").innerHTML = txTable(recent);
  draw("dashBar", barCfg(s.monthly));
  draw("dashPie", pieCfg(exp.categories));
}
async function loadList(type, el, totalEl) {
  const rows = await api("/api/transactions?type=" + type);
  $(el).innerHTML = txTable(rows);
  if (totalEl) $(totalEl).textContent = `Total ${money(sum(rows))}`;
}
async function loadLedger() {
  const p = new URLSearchParams();
  [["q", "#fQ"], ["type", "#fType"], ["category", "#fCat"], ["start", "#fStart"], ["end", "#fEnd"]]
    .forEach(([k, id]) => $(id).value && p.set(k, $(id).value));
  $("#ledgerList").innerHTML = txTable(await api("/api/transactions?" + p), { balance: true });
}
async function loadReports() {
  const y = $("#repYear").value, m = $("#repMonth").value;
  const d = await api(`/api/reports?year=${y}&month=${m}`);
  $("#exportBtn").href = `/api/export?year=${y}&month=${m}`;
  $("#r-income").textContent = money(d.totals.income);
  $("#r-expenses").textContent = money(d.totals.expenses);
  $("#r-net").textContent = money(d.totals.income - d.totals.expenses - d.totals.savings);
  draw("repBar", barCfg(d.monthly));
  draw("repPie", pieCfg(d.categories));
  const t = d.monthly.reduce((a, r) => ({ income: a.income + r.income, expenses: a.expenses + r.expenses, savings: a.savings + r.savings }), { income: 0, expenses: 0, savings: 0 });
  const line = (label, r) => `<tr><td>${label}</td><td class="num pos">${money(r.income)}</td><td class="num neg">${money(r.expenses)}</td><td class="num">${money(r.savings)}</td><td class="num"><strong>${money(r.income - r.expenses - r.savings)}</strong></td></tr>`;
  $("#repTable").innerHTML = `<table><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Savings</th><th class="num">Net balance</th></tr></thead><tbody>${d.monthly.map((r) => line(monthLabel(r.month), r)).join("")}${line("<strong>Year total</strong>", t)}</tbody></table>`;
}
async function loadSavings() {
  const [s, rows] = await Promise.all([api("/api/summary"), api("/api/transactions?type=savings")]);
  const f = $("#goalForm").elements;
  if (document.activeElement !== f.name && document.activeElement !== f.target) { f.name.value = s.goal.name; f.target.value = s.goal.target; }
  $("#s-bar").style.width = s.progress + "%";
  $("#s-pct").textContent = s.progress + "%";
  const left = Math.max(0, s.goal.target - s.savings);
  $("#s-text").textContent = `${money(s.savings)} saved toward "${s.goal.name}" - ${left ? money(left) + " to go" : "goal reached!"}`;
  $("#savingsList").innerHTML = txTable(rows);
}
const loaders = {
  dashboard: loadDashboard, ledger: loadLedger, reports: loadReports, savings: loadSavings,
  income: () => loadList("income", "#incomeList", "#incTotal"),
  expenses: () => loadList("expense", "#expenseList", "#expTotal"),
};
async function refresh() {
  try { await loaders[page](); } catch (e) { toast(e.message, true); }
}
function show(name) {
  page = name;
  document.querySelectorAll(".page").forEach((p) => (p.hidden = p.id !== "page-" + name));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
  $("#title").textContent = TITLES[name];
  $("#sidebar").classList.remove("open");
  refresh();
}

/* ---------- modal (add / edit) ---------- */
const form = $("#txForm"), F = form.elements;
function fillCats() {
  const t = F.ttype.value, sel = $("#tcatSel"), txt = $("#tcatTxt");
  sel.hidden = t === "income"; txt.hidden = t !== "income";
  sel.disabled = t === "savings";
  $("#catLabel").textContent = t === "income" ? "Income source" : "Category";
  sel.innerHTML = (t === "savings" ? ["Savings"] : window.CFG.expense).map((c) => `<option>${esc(c)}</option>`).join("");
  $("#srcList").innerHTML = window.CFG.income.map((c) => `<option value="${esc(c)}">`).join("");
}
function openModal(type, tx) {
  form.reset(); $("#formError").textContent = "";
  F.ttype.value = tx ? tx.type : type;
  fillCats();
  F.tid.value = tx ? tx.id : "";
  F.tdate.value = tx ? tx.date : new Date().toISOString().slice(0, 10);
  if (tx) {
    F.tamount.value = tx.amount; F.tdesc.value = tx.description;
    if (tx.type === "income") F.tcatText.value = tx.category; else if (tx.type === "expense") F.tcat.value = tx.category;
  }
  $("#modalTitle").textContent = tx ? "Edit transaction" : "Add " + F.ttype.value;
  $("#modal").showModal();
}
F.ttype.addEventListener("change", fillCats);
$("#cancelBtn").onclick = () => $("#modal").close();
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = F.ttype.value;
  const body = { type: t, category: t === "income" ? F.tcatText.value : F.tcat.value, amount: F.tamount.value, date: F.tdate.value, description: F.tdesc.value };
  if (!body.amount || +body.amount <= 0) return ($("#formError").textContent = "Enter an amount greater than zero.");
  if (!body.date) return ($("#formError").textContent = "Choose a date.");
  if (t === "income" && !body.category.trim()) return ($("#formError").textContent = "Enter an income source.");
  try {
    const id = F.tid.value;
    await api(id ? "/api/transactions/" + id : "/api/transactions", { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
    $("#modal").close(); toast(id ? "Transaction updated." : "Transaction added."); refresh();
  } catch (err) { $("#formError").textContent = err.message; }
});

/* ---------- events ---------- */
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.page) show(b.dataset.page);
  else if (b.dataset.add) openModal(b.dataset.add);
  else if (b.dataset.edit) openModal(null, cache[b.dataset.edit]);
  else if (b.dataset.del && confirm("Delete this transaction?")) {
    try { await api("/api/transactions/" + b.dataset.del, { method: "DELETE" }); toast("Transaction deleted."); refresh(); }
    catch (err) { toast(err.message, true); }
  }
});
$("#menu").onclick = () => $("#sidebar").classList.toggle("open");
$("#quickAdd").onclick = () => openModal(page === "income" ? "income" : page === "savings" ? "savings" : "expense");
$("#seedBtn").onclick = async () => { try { const r = await api("/api/seed", { method: "POST" }); toast(`Added ${r.added} sample transactions.`); refresh(); } catch (e) { toast(e.message, true); } };
$("#clearBtn").onclick = async () => {
  if (!confirm("Delete ALL transactions? This cannot be undone.")) return;
  try { await api("/api/clear", { method: "POST" }); toast("All data cleared."); refresh(); } catch (e) { toast(e.message, true); }
};
$("#goalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await api("/api/goal", { method: "PUT", body: JSON.stringify({ name: e.target.elements.name.value, target: e.target.elements.target.value }) }); toast("Savings goal saved."); refresh(); }
  catch (err) { toast(err.message, true); }
});

// ledger filters
$("#fCat").innerHTML = '<option value="">All categories</option>' + [...new Set([...window.CFG.expense, ...window.CFG.income, "Savings"])].map((c) => `<option>${esc(c)}</option>`).join("");
let timer;
$("#fQ").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(loadLedger, 250); });
["#fType", "#fCat", "#fStart", "#fEnd"].forEach((id) => $(id).addEventListener("change", loadLedger));
$("#fReset").onclick = () => { ["#fQ", "#fType", "#fCat", "#fStart", "#fEnd"].forEach((id) => ($(id).value = "")); loadLedger(); };

// report filters
const thisYear = new Date().getFullYear();
$("#repYear").innerHTML = Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => `<option>${y}</option>`).join("");
$("#repMonth").innerHTML = '<option value="0">Whole year</option>' + MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
["#repYear", "#repMonth"].forEach((id) => $(id).addEventListener("change", loadReports));

show("dashboard");
