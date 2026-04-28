import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

const categories = [
  "Food",
  "Travel",
  "Bills",
  "Shopping",
  "Health",
  "Other"
];

const toCents = (amount) => {
  if (typeof amount !== "string") {
    amount = String(amount ?? "0");
  }
  const [whole, fraction = ""] = amount.split(".");
  const safeWhole = whole.replace(/[^0-9]/g, "") || "0";
  const safeFraction = (fraction + "00").slice(0, 2);
  return Number.parseInt(safeWhole, 10) * 100 + Number.parseInt(safeFraction, 10);
};

const isValidAmount = (value) => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return false;
  return toCents(trimmed) > 0;
};

const formatMoney = (amount) => {
  const cents = toCents(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
};

const createTempId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `temp-${crypto.randomUUID()}`;
  }
  return `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export default function App() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    amount: "",
    category: categories[0],
    description: "",
    date: new Date().toISOString().slice(0, 10)
  });
  const [searchDraft, setSearchDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchDraft.trim());
      setCategoryFilter(categoryDraft);
    }, 300);

    return () => clearTimeout(handle);
  }, [searchDraft, categoryDraft]);

  const fetchExpenses = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/expenses?sort=date_desc`);
      if (!response.ok) {
        throw new Error("Failed to fetch expenses");
      }
      const data = await response.json();
      setExpenses(data);
    } catch (err) {
      setError(err.message || "Could not load expenses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const trimmedDescription = form.description.trim();
    if (!isValidAmount(form.amount)) {
      setError("Amount must be a positive decimal.");
      setSubmitting(false);
      return;
    }
    if (!trimmedDescription) {
      setError("Description is required.");
      setSubmitting(false);
      return;
    }

    const payload = {
      amount: form.amount.trim(),
      category: form.category,
      description: trimmedDescription,
      date: form.date
    };

    const optimisticId = createTempId();
    const optimistic = {
      ...payload,
      id: optimisticId,
      created_at: new Date().toISOString(),
      optimistic: true
    };

    setExpenses((prev) => [optimistic, ...prev]);

    try {
      const response = await fetch(`${API_BASE}/expenses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": optimisticId
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Failed to add expense");
      }

      const saved = await response.json();
      setExpenses((prev) =>
        prev.map((item) => (item.id === optimisticId ? saved : item))
      );
      setForm((prev) => ({ ...prev, amount: "", description: "" }));
    } catch (err) {
      setExpenses((prev) => prev.filter((item) => item.id !== optimisticId));
      setError(err.message || "Could not save expense.");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    return expenses
      .filter((expense) =>
        categoryFilter === "All" ? true : expense.category === categoryFilter
      )
      .filter((expense) =>
        searchLower
          ? expense.description.toLowerCase().includes(searchLower)
          : true
      )
      .sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        return new Date(b.created_at) - new Date(a.created_at);
      });
  }, [expenses, categoryFilter, searchTerm]);

  const totalCents = filtered.reduce(
    (sum, expense) => sum + toCents(expense.amount),
    0
  );

  const canSubmit =
    !submitting &&
    isValidAmount(form.amount) &&
    form.description.trim().length > 0;

  const categoryBreakdown = useMemo(() => {
    const totals = {};
    filtered.forEach((expense) => {
      totals[expense.category] =
        (totals[expense.category] || 0) + toCents(expense.amount);
    });
    const overall = Object.values(totals).reduce((sum, val) => sum + val, 0);
    return Object.entries(totals)
      .map(([category, cents]) => ({
        category,
        cents,
        percent: overall ? Math.round((cents / overall) * 100) : 0
      }))
      .sort((a, b) => b.cents - a.cents);
  }, [filtered]);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Fenmo Labs</p>
          <h1>Expense Tracker</h1>
          <p className="lead">
            Built for reliable money tracking with idempotent writes and clear
            analytics.
          </p>
        </div>
        <div className="hero-card">
          <span>Total (filtered)</span>
          <strong>{formatMoney((totalCents / 100).toFixed(2))}</strong>
          <small>{filtered.length} expense entries</small>
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <h2>Add an expense</h2>
          <form className="expense-form" onSubmit={handleSubmit}>
            <label>
              Amount
              <input
                name="amount"
                type="text"
                inputMode="decimal"
                placeholder="45.50"
                value={form.amount}
                onChange={handleChange}
                required
              />
            </label>
            <label>
              Category
              <select
                name="category"
                value={form.category}
                onChange={handleChange}
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description
              <input
                name="description"
                type="text"
                placeholder="Groceries, Uber, Gym"
                value={form.description}
                onChange={handleChange}
                required
              />
            </label>
            <label>
              Date
              <input
                name="date"
                type="date"
                value={form.date}
                onChange={handleChange}
                required
              />
            </label>
            <button disabled={!canSubmit} type="submit">
              {submitting ? "Saving..." : "Add expense"}
            </button>
          </form>
          {error ? <p className="error">{error}</p> : null}
        </section>

        <section className="panel wide">
          <div className="panel-header">
            <div>
              <h2>Recent expenses</h2>
              <p>Filter and sort without extra API calls.</p>
            </div>
            <div className="filters">
              <label>
                Search
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Search description"
                />
              </label>
              <label>
                Category
                <select
                  value={categoryDraft}
                  onChange={(event) => setCategoryDraft(event.target.value)}
                >
                  <option value="All">All</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {loading ? (
            <p className="status">Loading expenses...</p>
          ) : filtered.length === 0 ? (
            <p className="status">No expenses match the current filters.</p>
          ) : (
            <div className="table">
              <div className="table-row table-head">
                <span>Date</span>
                <span>Category</span>
                <span>Description</span>
                <span className="align-right">Amount</span>
              </div>
              {filtered.map((expense) => (
                <div
                  className={`table-row ${expense.optimistic ? "pending" : ""}`}
                  key={expense.id}
                >
                  <span>{expense.date}</span>
                  <span>{expense.category}</span>
                  <span>{expense.description}</span>
                  <span className="align-right">
                    {formatMoney(expense.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel wide">
          <div className="panel-header">
            <div>
              <h2>Category breakdown</h2>
              <p>Quick view of spending distribution.</p>
            </div>
          </div>
          {categoryBreakdown.length === 0 ? (
            <p className="status">Add expenses to see the distribution.</p>
          ) : (
            <div className="breakdown">
              {categoryBreakdown.map((item) => (
                <div key={item.category} className="break-row">
                  <div>
                    <strong>{item.category}</strong>
                    <span>{formatMoney((item.cents / 100).toFixed(2))}</span>
                  </div>
                  <div className="bar">
                    <div
                      className="bar-fill"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                  <span className="percent">{item.percent}%</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
