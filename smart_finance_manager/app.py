"""Smart Finance Manager - Flask backend (fictional data only, no bank connections)."""
import csv
import io
import os
import random
import sqlite3
from datetime import date, datetime, timedelta

from flask import Flask, Response, g, jsonify, render_template, request

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "finance.db")

EXPENSE_CATS = ["Food", "Education", "Transport", "Shopping", "Bills", "Health", "Entertainment", "Other"]
INCOME_SRC = ["Salary", "Freelance", "Business", "Investments", "Gift", "Other"]
TYPES = {"income", "expense", "savings"}
KEY = {"income": "income", "expense": "expenses", "savings": "savings"}


# ---------- database helpers ----------
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_):
    conn = g.pop("db", None)
    if conn:
        conn.close()


def init_db():
    with sqlite3.connect(DB_PATH) as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS transactions(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK(type IN ('income','expense','savings')),
                category TEXT NOT NULL,
                amount REAL NOT NULL CHECK(amount > 0),
                date TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '');
            CREATE TABLE IF NOT EXISTS goal(
                id INTEGER PRIMARY KEY CHECK(id = 1),
                name TEXT NOT NULL,
                target REAL NOT NULL CHECK(target > 0));
            INSERT OR IGNORE INTO goal VALUES (1, 'Emergency fund', 5000);
            CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
            """
        )


# ---------- validation ----------
def clean_tx(d):
    if not isinstance(d, dict):
        raise ValueError("Invalid request body.")
    t = d.get("type")
    if t not in TYPES:
        raise ValueError("Type must be income, expense or savings.")
    try:
        amount = round(float(d.get("amount")), 2)
    except (TypeError, ValueError):
        raise ValueError("Amount must be a number.")
    if not 0 < amount <= 1_000_000_000:
        raise ValueError("Amount must be between 0.01 and 1,000,000,000.")
    try:
        dt = datetime.strptime(str(d.get("date")), "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Date must be a valid date (YYYY-MM-DD).")
    if dt.year < 2000 or dt > date.today() + timedelta(days=366):
        raise ValueError("Date is out of the allowed range.")
    cat = str(d.get("category") or "").strip()[:40]
    if t == "savings":
        cat = "Savings"
    elif t == "expense" and cat not in EXPENSE_CATS:
        raise ValueError("Choose a valid expense category.")
    elif t == "income" and not cat:
        raise ValueError("Income source is required.")
    desc = str(d.get("description") or "").strip()
    if len(desc) > 200:
        raise ValueError("Description must be 200 characters or fewer.")
    return t, cat, amount, dt.isoformat(), desc


def period_prefix():
    year = request.args.get("year", date.today().year, type=int)
    month = request.args.get("month", 0, type=int)
    if not 2000 <= year <= 2100 or not 0 <= month <= 12:
        raise ValueError("Invalid period.")
    return (f"{year}-{month:02d}" if month else str(year)), year, month


@app.errorhandler(ValueError)
def bad_request(e):
    return jsonify(error=str(e)), 400


# ---------- pages ----------
@app.get("/")
def index():
    return render_template("index.html", cfg={"expense": EXPENSE_CATS, "income": INCOME_SRC})


# ---------- transactions ----------
@app.get("/api/transactions")
def list_tx():
    where, params = [], []
    a = request.args
    if a.get("type") in TYPES:
        where.append("type = ?"); params.append(a["type"])
    if a.get("category"):
        where.append("category = ?"); params.append(a["category"])
    for key, op in (("start", ">="), ("end", "<=")):
        if a.get(key):
            try:
                datetime.strptime(a[key], "%Y-%m-%d")
            except ValueError:
                raise ValueError("Filter dates must be YYYY-MM-DD.")
            where.append(f"date {op} ?"); params.append(a[key])
    q = a.get("q", "").strip()[:100]
    if q:
        esc = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        where.append("(description LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')")
        params += [f"%{esc}%"] * 2
    sql = ("SELECT * FROM (SELECT t.*, ROUND(SUM(CASE WHEN type='income' THEN amount ELSE -amount END) "
           "OVER (ORDER BY date, id), 2) AS balance FROM transactions t)")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY date DESC, id DESC"
    limit = a.get("limit", type=int)
    if limit:
        sql += " LIMIT ?"; params.append(min(limit, 1000))
    return jsonify([dict(r) for r in db().execute(sql, params)])


@app.post("/api/transactions")
def add_tx():
    cur = db().execute("INSERT INTO transactions(type,category,amount,date,description) VALUES (?,?,?,?,?)",
                       clean_tx(request.get_json(silent=True)))
    db().commit()
    return jsonify(id=cur.lastrowid), 201


@app.put("/api/transactions/<int:tid>")
def edit_tx(tid):
    cur = db().execute("UPDATE transactions SET type=?,category=?,amount=?,date=?,description=? WHERE id=?",
                       (*clean_tx(request.get_json(silent=True)), tid))
    db().commit()
    return (jsonify(ok=True), 200) if cur.rowcount else (jsonify(error="Transaction not found."), 404)


@app.delete("/api/transactions/<int:tid>")
def delete_tx(tid):
    cur = db().execute("DELETE FROM transactions WHERE id=?", (tid,))
    db().commit()
    return (jsonify(ok=True), 200) if cur.rowcount else (jsonify(error="Transaction not found."), 404)


# ---------- accounting ----------
def last_months(n):
    y, m = date.today().year, date.today().month
    out = []
    for i in range(n - 1, -1, -1):
        mm, yy = m - i, y
        while mm <= 0:
            mm += 12; yy -= 1
        out.append(f"{yy}-{mm:02d}")
    return out


@app.get("/api/summary")
def summary():
    totals = {r["type"]: r["s"] for r in db().execute(
        "SELECT type, SUM(amount) s FROM transactions GROUP BY type")}
    inc, exp, sav = totals.get("income", 0), totals.get("expense", 0), totals.get("savings", 0)
    goal = dict(db().execute("SELECT name, target FROM goal").fetchone())
    months = {m: {"month": m, "income": 0, "expenses": 0, "savings": 0} for m in last_months(6)}
    for r in db().execute("SELECT substr(date,1,7) m, type, SUM(amount) s FROM transactions GROUP BY m, type"):
        if r["m"] in months:
            months[r["m"]][KEY[r["type"]]] = r["s"]
    return jsonify(income=inc, expenses=exp, savings=sav, balance=round(inc - exp - sav, 2), goal=goal,
                   progress=round(min(100, sav / goal["target"] * 100), 1), monthly=list(months.values()))


@app.get("/api/reports")
def reports():
    prefix, year, _ = period_prefix()
    monthly = {f"{year}-{i:02d}": {"month": f"{year}-{i:02d}", "income": 0, "expenses": 0, "savings": 0}
               for i in range(1, 13)}
    for r in db().execute("SELECT substr(date,1,7) m, type, SUM(amount) s FROM transactions "
                          "WHERE substr(date,1,4)=? GROUP BY m, type", (str(year),)):
        monthly[r["m"]][KEY[r["type"]]] = r["s"]
    cats = [dict(r) for r in db().execute(
        "SELECT category, SUM(amount) total FROM transactions WHERE type='expense' AND date LIKE ? "
        "GROUP BY category ORDER BY total DESC", (prefix + "%",))]
    totals = {r["type"]: r["s"] for r in db().execute(
        "SELECT type, SUM(amount) s FROM transactions WHERE date LIKE ? GROUP BY type", (prefix + "%",))}
    return jsonify(monthly=list(monthly.values()), categories=cats,
                   totals={"income": totals.get("income", 0), "expenses": totals.get("expense", 0),
                           "savings": totals.get("savings", 0)})


@app.get("/api/export")
def export_csv():
    prefix, _, _ = period_prefix()
    rows = db().execute("SELECT date, type, category, description, amount FROM transactions "
                        "WHERE date LIKE ? ORDER BY date, id", (prefix + "%",)).fetchall()
    safe = lambda v: "'" + v if isinstance(v, str) and v[:1] in "=+-@" else v  # block CSV formula injection
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Type", "Category", "Description", "Amount"])
    tot = {"income": 0, "expense": 0, "savings": 0}
    for r in rows:
        w.writerow([safe(r["date"]), r["type"], safe(r["category"]), safe(r["description"]), f"{r['amount']:.2f}"])
        tot[r["type"]] += r["amount"]
    w.writerow([])
    w.writerow(["Total income", "", "", "", f"{tot['income']:.2f}"])
    w.writerow(["Total expenses", "", "", "", f"{tot['expense']:.2f}"])
    w.writerow(["Total savings", "", "", "", f"{tot['savings']:.2f}"])
    w.writerow(["Net balance", "", "", "", f"{tot['income'] - tot['expense'] - tot['savings']:.2f}"])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=report_{prefix}.csv"})


# ---------- savings goal ----------
@app.put("/api/goal")
def set_goal():
    d = request.get_json(silent=True) or {}
    name = str(d.get("name") or "").strip()[:60]
    try:
        target = round(float(d.get("target")), 2)
    except (TypeError, ValueError):
        raise ValueError("Target must be a number.")
    if not name:
        raise ValueError("Goal name is required.")
    if not 0 < target <= 1_000_000_000:
        raise ValueError("Target must be greater than zero.")
    db().execute("UPDATE goal SET name=?, target=? WHERE id=1", (name, target))
    db().commit()
    return jsonify(ok=True)


# ---------- demo data ----------
@app.post("/api/seed")
def seed():
    rnd, today, rows = random.Random(42), date.today(), []
    for ym in last_months(6):
        y, m = map(int, ym.split("-"))
        def add(day, t, cat, lo, hi, desc):
            d = date(y, m, min(day, 28))
            if d <= today:
                rows.append((t, cat, round(rnd.uniform(lo, hi), 2), d.isoformat(), desc))
        add(1, "income", "Salary", 4200, 4200, "Monthly salary (demo)")
        if rnd.random() < .7:
            add(14, "income", "Freelance", 300, 900, "Freelance project (demo)")
        add(2, "expense", "Bills", 1100, 1100, "Rent")
        add(8, "expense", "Bills", 60, 140, "Electricity and internet")
        for d_, desc in ((4, "Groceries"), (11, "Restaurant"), (18, "Groceries"), (25, "Coffee and snacks")):
            add(d_, "expense", "Food", 15, 120, desc)
        for d_ in (6, 16, 24):
            add(d_, "expense", "Transport", 10, 55, "Metro card / fuel")
        add(20, "expense", "Shopping", 40, 260, "Clothes and accessories")
        if rnd.random() < .6:
            add(9, "expense", "Education", 40, 220, "Online course / books")
        add(27, "savings", "Savings", 250, 500, "Monthly savings transfer")
    db().executemany("INSERT INTO transactions(type,category,amount,date,description) VALUES (?,?,?,?,?)", rows)
    db().commit()
    return jsonify(added=len(rows))


@app.post("/api/clear")
def clear():
    db().execute("DELETE FROM transactions")
    db().commit()
    return jsonify(ok=True)


init_db()

if __name__ == "__main__":
    app.run(debug=True)
