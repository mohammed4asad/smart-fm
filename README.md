# Smart Finance Manager

A Flask + SQLite finance dashboard. All data is local and fictional; there are no bank or payment connections.

## Project structure

```
smart_finance_manager/
├── app.py                 # Flask backend, REST API, validation, SQLite
├── requirements.txt
├── templates/index.html   # Single-page HTML shell
└── static/
    ├── css/style.css      # Navy / white / green responsive theme
    └── js/app.js          # Navigation, charts, CRUD, filters
```

## Run it

1. Install Python 3.9+ (SQLite 3.25+ is bundled with it).
2. Open a terminal in the `smart_finance_manager` folder.
3. (Recommended) create a virtual environment:
   - macOS/Linux: `python3 -m venv venv && source venv/bin/activate`
   - Windows: `python -m venv venv && venv\Scripts\activate`
4. Install dependencies: `pip install -r requirements.txt`
5. Start the server: `python app.py`
6. Open http://127.0.0.1:5000 in your browser.

The database file `finance.db` is created automatically on first run.
Click **Load sample data** in the sidebar to fill the app with six months of demo transactions.
Charts use Chart.js from a CDN, so the browser needs internet access the first time it loads the page.

## Features

- **Dashboard**: income, expenses, balance, savings, 6-month chart, category chart, goal progress, recent transactions.
- **Income / Expenses**: add, edit, delete. Expense categories: Food, Education, Transport, Shopping, Bills, Health, Entertainment, Other.
- **Ledger**: every transaction with a running balance; search, filter by type, category and date range.
- **Reports**: yearly or monthly view, income vs expenses bar chart, expense category chart, monthly summary table, CSV export.
- **Savings**: set a goal name and target; contributions update the percentage completed.

Balance = total income - total expenses - total savings.

## Notes

- Change the currency symbol with `CUR` at the top of `static/js/app.js`.
- Inputs are validated in the browser and again on the server; all SQL uses parameters, and CSV exports neutralise spreadsheet formulas.
- For production use, run behind a WSGI server (e.g. gunicorn) with `debug` turned off.
