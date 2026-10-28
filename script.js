/* =================================
   SMARTTRACK
   Everything on the dashboard is calculated from one list of transactions
   saved in this browser's localStorage. No server, no account, and the
   "insights" are plain rules (no AI model).
================================= */

const STORAGE_KEY = "smartTrack";
const STATE_VERSION = 1;

const EXPENSE_CATEGORIES = ["Food", "Transport", "Shopping", "Entertainment", "Bills", "Health", "Other"];
const INCOME_CATEGORIES = ["Salary", "Freelance", "Gift", "Other"];

const ICONS = {
    Food: "🍔", Transport: "🚕", Shopping: "🛍", Entertainment: "🎮", Bills: "🧾", Health: "💊",
    Salary: "💼", Freelance: "💻", Gift: "🎁", Other: "📦"
};

const DEFAULT_BUDGETS = { Food: 500, Transport: 300, Shopping: 450, Entertainment: 250 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RECENT_LIMIT = 5;
const INSIGHT_LIMIT = 2;

// =================================
// HELPERS
// =================================

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(year, month) {
    // month is 0-11; values outside the range roll over into the right year
    const d = new Date(year, month, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function parseDay(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}

function money(amount) {
    return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function compactMoney(amount) {
    if (amount >= 1000) {
        const k = amount / 1000;
        return "$" + (Number.isInteger(k) ? k : k.toFixed(1)) + "k";
    }
    return "$" + Math.round(amount);
}

// Strictly increasing ids, so "newest first" ordering is always reliable.
let lastId = 0;
function newId() {
    lastId = Math.max(lastId + 1, Date.now());
    return lastId;
}

function dayLabel(key) {
    const today = dayKey();
    const yesterday = dayKey(new Date(Date.now() - 86400000));
    if (key === today) return "Today";
    if (key === yesterday) return "Yesterday";
    return parseDay(key).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

// =================================
// STATE
// =================================

function sampleData() {
    const now = new Date();
    const transactions = [];
    let id = 1;
    const add = (type, title, amount, category, date) => transactions.push({ id: id++, type, title, amount, category, date });

    // Five earlier months of sample history so the chart has something to show.
    const history = [
        [5, 5000, [380, 190, 260, 110, 60]],
        [4, 5000, [420, 210, 340, 90, 70]],
        [3, 5100, [350, 170, 410, 150, 55]],
        [2, 5100, [400, 230, 300, 120, 80]],
        [1, 5250, [310, 200, 380, 130, 65]]
    ];
    for (const [back, salary, spend] of history) {
        const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
        const prefix = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        add("income", "Monthly Salary", salary, "Salary", `${prefix}-01`);
        ["Food", "Transport", "Shopping", "Entertainment", "Bills"].forEach((category, i) => {
            add("expense", `${category} (sample)`, spend[i], category, `${prefix}-${pad(5 + i * 5)}`);
        });
    }

    // This month, same entries as the original demo.
    const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    add("income", "Monthly Salary", 5250, "Salary", `${thisMonth}-01`);
    add("expense", "McDonald's", 18.5, "Food", dayKey());
    add("expense", "Uber", 24.8, "Transport", dayKey());
    add("expense", "Amazon", 86.2, "Shopping", dayKey(new Date(Date.now() - 86400000)));
    add("expense", "Groceries", 265.5, "Food", `${thisMonth}-02`);
    add("expense", "Metro card", 155.2, "Transport", `${thisMonth}-02`);
    add("expense", "Headphones", 333.8, "Shopping", `${thisMonth}-03`);
    add("expense", "Cinema", 120, "Entertainment", `${thisMonth}-03`);

    return { version: STATE_VERSION, demo: true, transactions, budgets: { ...DEFAULT_BUDGETS } };
}

function emptyData() {
    return { version: STATE_VERSION, demo: false, transactions: [], budgets: { ...DEFAULT_BUDGETS } };
}

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved && Array.isArray(saved.transactions)) {
            const base = emptyData();
            base.demo = Boolean(saved.demo);
            base.transactions = saved.transactions;
            if (saved.budgets && typeof saved.budgets === "object") base.budgets = saved.budgets;
            return base;
        }
    } catch (error) {
        /* storage blocked or corrupted: fall through to sample data */
    }
    return sampleData();
}

const state = loadState();

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        /* storage full or blocked: the page still works for this visit */
    }
}

// =================================
// CALCULATIONS
// =================================

function totalsFor(key) {
    let income = 0;
    let expense = 0;
    for (const t of state.transactions) {
        if (!t.date.startsWith(key)) continue;
        if (t.type === "income") income += t.amount;
        else expense += t.amount;
    }
    return { income, expense };
}

function expensesByCategory(key) {
    const result = {};
    for (const t of state.transactions) {
        if (t.type === "expense" && t.date.startsWith(key)) {
            result[t.category] = (result[t.category] || 0) + t.amount;
        }
    }
    return result;
}

function percentChange(current, previous) {
    return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

function formatChange(change) {
    if (change === null) return "no data";
    const arrow = change >= 0 ? "↑" : "↓";
    return `${arrow} ${Math.abs(change).toFixed(1)}%`;
}

// "Nice" axis: three equal steps with a round step size (1, 2, 5 × 10^n).
function niceAxisTop(max) {
    if (max <= 0) return 3;
    const raw = max / 3;
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const fraction = raw / power;
    const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
    return step * 3;
}

// =================================
// RENDER
// =================================

function setDelta(id, text, good) {
    const el = $(id);
    el.textContent = text;
    el.className = good === null ? "" : good ? "positive" : "negative";
}

function renderOverview() {
    const now = new Date();
    const current = monthKey(now.getFullYear(), now.getMonth());
    const previous = monthKey(now.getFullYear(), now.getMonth() - 1);
    const cur = totalsFor(current);
    const prev = totalsFor(previous);

    const balance = state.transactions.reduce((sum, t) => sum + (t.type === "income" ? t.amount : -t.amount), 0);
    $("balanceValue").textContent = money(balance);
    const net = cur.income - cur.expense;
    setDelta("balanceDelta", `${net >= 0 ? "↑ +" : "↓ −"}${money(Math.abs(net))}`, net >= 0);

    $("incomeValue").textContent = money(cur.income);
    const incomeChange = percentChange(cur.income, prev.income);
    setDelta("incomeDelta", formatChange(incomeChange), incomeChange === null ? null : incomeChange >= 0);

    $("expenseValue").textContent = money(cur.expense);
    const expenseChange = percentChange(cur.expense, prev.expense);
    setDelta("expenseDelta", formatChange(expenseChange), expenseChange === null ? null : expenseChange <= 0);

    const rate = cur.income > 0 ? ((cur.income - cur.expense) / cur.income) * 100 : 0;
    $("savingsValue").textContent = `${rate.toFixed(1)}%`;
    if (cur.income <= 0) {
        setDelta("savingsDelta", "—", null);
        $("savingsText").textContent = "add income to see it";
    } else {
        const good = rate >= 20;
        setDelta("savingsDelta", rate >= 0 ? "↑ saving" : "↓ overspending", rate >= 0);
        $("savingsText").textContent = good ? "great progress" : "aim for 20%+";
    }
}

function chartMonths() {
    const now = new Date();
    const mode = $("chartRange").value;
    const months = [];
    if (mode === "lastYear") {
        for (let m = 0; m < 12; m++) months.push([now.getFullYear() - 1, m]);
    } else if (mode === "sixMonths") {
        for (let i = 5; i >= 0; i--) months.push([now.getFullYear(), now.getMonth() - i]);
    } else {
        for (let m = 0; m <= now.getMonth(); m++) months.push([now.getFullYear(), m]);
    }
    return months.map(([y, m]) => {
        const d = new Date(y, m, 1);
        return { label: MONTHS[d.getMonth()], ...totalsFor(monthKey(d.getFullYear(), d.getMonth())) };
    });
}

function renderChart() {
    const months = chartMonths();
    const max = Math.max(0, ...months.flatMap((m) => [m.income, m.expense]));
    const top = niceAxisTop(max);

    $("chartAxis").innerHTML = [3, 2, 1, 0].map((i) => `<span>${compactMoney((top / 3) * i)}</span>`).join("");

    const height = (value) => (value <= 0 ? 0 : Math.max(1.5, (value / top) * 100));
    $("chartBars").innerHTML = months.map((m) => `
        <div class="bar-group" title="${esc(m.label)}: income ${esc(money(m.income))}, expenses ${esc(money(m.expense))}">
            <div class="bar income" style="height: ${height(m.income)}%;"></div>
            <div class="bar expense" style="height: ${height(m.expense)}%;"></div>
            <span>${esc(m.label)}</span>
        </div>`).join("");

    $("chartBars").setAttribute("aria-label",
        "Monthly income and expenses: " + months.map((m) => `${m.label} income ${money(m.income)}, expenses ${money(m.expense)}`).join("; "));
}

let showAllInsights = false;

function renderInsights() {
    const now = new Date();
    const current = monthKey(now.getFullYear(), now.getMonth());
    const previous = monthKey(now.getFullYear(), now.getMonth() - 1);
    const cur = totalsFor(current);

    // Average spending of earlier months that have any spending (up to 6).
    const earlier = [];
    for (let i = 1; i <= 6; i++) {
        const t = totalsFor(monthKey(now.getFullYear(), now.getMonth() - i));
        if (t.expense > 0) earlier.push(t.expense);
    }

    const title = $("insightTitle");
    const text = $("insightText");
    if (!state.transactions.length) {
        title.textContent = "Getting started";
        text.textContent = "Add a few transactions to see insights.";
    } else if (!earlier.length) {
        title.textContent = "Keep tracking";
        text.textContent = "Insights compare this month with your earlier months. Keep adding transactions.";
    } else {
        const average = earlier.reduce((a, b) => a + b, 0) / earlier.length;
        const diff = ((cur.expense - average) / average) * 100;
        if (diff <= 0) {
            title.textContent = "You're doing great!";
            text.innerHTML = `Your spending is <strong>${Math.abs(diff).toFixed(0)}%</strong> lower than your monthly average.`;
        } else {
            title.textContent = "Spending is up";
            text.innerHTML = `Your spending is <strong>${diff.toFixed(0)}%</strong> higher than your monthly average.`;
        }
    }

    const nowByCategory = expensesByCategory(current);
    const prevByCategory = expensesByCategory(previous);
    const rows = Object.entries(nowByCategory).sort((a, b) => b[1] - a[1]);
    const shown = showAllInsights ? rows : rows.slice(0, INSIGHT_LIMIT);

    $("insightList").innerHTML = shown.length ? shown.map(([category, amount]) => {
        const change = percentChange(amount, prevByCategory[category] || 0);
        const label = change === null ? "new" : `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(0)}%`;
        const warn = change !== null && change > 0;
        return `
        <div class="insight-item">
            <span class="mini-icon ${esc(category.toLowerCase())}">${ICONS[category] || "📦"}</span>
            <div>
                <strong>${esc(category)}</strong>
                <p>${esc(money(amount))} this month</p>
            </div>
            <span class="insight-value ${warn ? "warning" : ""}">${label}</span>
        </div>`;
    }).join("") : `<p class="empty-state">No spending recorded this month.</p>`;

    $("insightsToggle").hidden = rows.length <= INSIGHT_LIMIT;
    $("insightsToggle").textContent = showAllInsights ? "Show fewer insights" : "View all insights →";
}

let showAllTransactions = false;

function renderTransactions() {
    const sorted = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const shown = showAllTransactions ? sorted : sorted.slice(0, RECENT_LIMIT);

    $("txList").innerHTML = shown.length ? shown.map((t) => {
        const isIncome = t.type === "income";
        return `
        <div class="transaction">
            <div class="transaction-left">
                <div class="transaction-icon ${esc(t.category.toLowerCase())}">${ICONS[t.category] || "📦"}</div>
                <div>
                    <strong>${esc(t.title)}</strong>
                    <span>${esc(t.category)} • ${esc(dayLabel(t.date))}</span>
                </div>
            </div>
            <div class="transaction-right">
                <strong class="amount ${isIncome ? "income-text" : "expense"}">${isIncome ? "+" : "-"}${esc(money(t.amount))}</strong>
                <button type="button" class="mini-btn" data-delete="${t.id}"
                    aria-label="Delete ${esc(t.title)}">✕</button>
            </div>
        </div>`;
    }).join("") : `<p class="empty-state">No transactions yet. Use “Add Expense” or “Add Income”.</p>`;

    $("txToggle").hidden = sorted.length <= RECENT_LIMIT;
    $("txToggle").textContent = showAllTransactions ? "Show recent →" : "View all →";
}

function renderBudgets() {
    const now = new Date();
    const spent = expensesByCategory(monthKey(now.getFullYear(), now.getMonth()));
    const entries = Object.entries(state.budgets).filter(([, limit]) => limit > 0);

    $("budgetList").innerHTML = entries.length ? entries.map(([category, limit]) => {
        const used = spent[category] || 0;
        const percent = Math.min(100, (used / limit) * 100);
        const danger = used / limit >= 0.9;
        return `
        <div class="budget-item">
            <div class="budget-info">
                <span>${ICONS[category] || "📦"} ${esc(category)}</span>
                <strong>${esc(money(used))} / ${esc(money(limit))}</strong>
            </div>
            <div class="progress ${danger ? "danger" : ""}" role="progressbar" aria-label="${esc(category)} budget used"
                aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}">
                <span style="width: ${percent}%;"></span>
            </div>
        </div>`;
    }).join("") : `<p class="empty-state">No limits set. Choose “Manage”.</p>`;
}

function renderGreeting() {
    const hour = new Date().getHours();
    const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    $("greeting").textContent = `${part}, Omar 👋`;
}

function renderAll() {
    renderGreeting();
    renderOverview();
    renderChart();
    renderInsights();
    renderTransactions();
    renderBudgets();
    $("demoNote").hidden = !state.demo;
}

function change(mutator) {
    mutator();
    saveState();
    renderAll();
}

// =================================
// ADD TRANSACTION
// =================================

function fillCategories() {
    const list = $("txType").value === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    $("txCategory").innerHTML = list.map((c) => `<option>${esc(c)}</option>`).join("");
}

function openTransactionDialog(type) {
    $("txType").value = type;
    fillCategories();
    $("txDialogTitle").textContent = type === "income" ? "Add income" : "Add expense";
    $("txName").value = "";
    $("txAmount").value = "";
    $("txDate").value = dayKey();
    $("txDialog").showModal();
    $("txName").focus();
}

$("addExpenseBtn").addEventListener("click", () => openTransactionDialog("expense"));
$("addIncomeBtn").addEventListener("click", () => openTransactionDialog("income"));
$("txType").addEventListener("change", () => {
    fillCategories();
    $("txDialogTitle").textContent = $("txType").value === "income" ? "Add income" : "Add expense";
});
$("txCancel").addEventListener("click", () => $("txDialog").close());

$("txForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number($("txAmount").value);
    const title = $("txName").value.trim();
    if (!title || !Number.isFinite(amount) || amount <= 0) return;
    change(() => {
        state.transactions.push({
            id: newId(),
            type: $("txType").value,
            title,
            amount: Math.round(amount * 100) / 100,
            category: $("txCategory").value,
            date: $("txDate").value || dayKey()
        });
    });
    $("txDialog").close();
});

$("txList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    const id = Number(button.dataset.delete);
    change(() => { state.transactions = state.transactions.filter((t) => t.id !== id); });
});

$("txToggle").addEventListener("click", () => { showAllTransactions = !showAllTransactions; renderTransactions(); });
$("insightsToggle").addEventListener("click", () => { showAllInsights = !showAllInsights; renderInsights(); });
$("chartRange").addEventListener("change", renderChart);

// =================================
// BUDGET LIMITS
// =================================

$("manageBudgets").addEventListener("click", () => {
    $("budgetFields").innerHTML = EXPENSE_CATEGORIES.map((category) => `
        <label for="limit-${esc(category)}">${ICONS[category]} ${esc(category)}</label>
        <input id="limit-${esc(category)}" data-category="${esc(category)}" type="number" min="0" step="1" inputmode="numeric"
            value="${Number(state.budgets[category]) || 0}">`).join("");
    $("budgetDialog").showModal();
});

$("budgetCancel").addEventListener("click", () => $("budgetDialog").close());

$("budgetForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const budgets = {};
    document.querySelectorAll("#budgetFields input").forEach((input) => {
        const value = Math.max(0, Math.round(Number(input.value) || 0));
        if (value > 0) budgets[input.dataset.category] = value;
    });
    change(() => { state.budgets = budgets; });
    $("budgetDialog").close();
});

// =================================
// NAVIGATION, SAMPLE DATA, SETTINGS
// =================================

const navItems = document.querySelectorAll(".nav-item");

function scrollToSection(id) {
    const target = $(id);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

navItems.forEach((item) => {
    item.addEventListener("click", (event) => {
        event.preventDefault();
        if (item.dataset.action === "settings") {
            if (confirm("Delete ALL transactions and limits saved by SmartTrack in this browser?")) {
                Object.assign(state, emptyData());
                saveState();
                renderAll();
            }
            return;
        }
        navItems.forEach((n) => n.classList.remove("active"));
        item.classList.add("active");
        scrollToSection(item.dataset.target);
    });
});

$("exploreInsights").addEventListener("click", () => scrollToSection("sec-insights"));

$("clearDemoBtn").addEventListener("click", () => {
    if (!confirm("Remove the sample data and start with an empty SmartTrack?")) return;
    Object.assign(state, emptyData());
    saveState();
    renderAll();
});

// =================================
// START
// =================================

renderAll();
