import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mysql from "mysql2/promise";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  connectionLimit: 10
});

const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const MAX_AMOUNT_CENTS = 9999999999;
const idempotencyCache = new Map();
const idempotencyLocks = new Map();

pool
  .getConnection()
  .then((connection) => {
    connection.release();
    console.log("Database connection ready");
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
  });

const amountToCents = (amount) => {
  if (typeof amount !== "string") {
    amount = String(amount ?? "0");
  }
  const [whole, fraction = ""] = amount.split(".");
  const safeWhole = whole.replace(/[^0-9]/g, "") || "0";
  const safeFraction = (fraction + "00").slice(0, 2);
  return Number.parseInt(safeWhole, 10) * 100 + Number.parseInt(safeFraction, 10);
};

const normalizeText = (value) =>
  typeof value === "string" ? value.trim() : "";

const isValidText = (value, maxLength) =>
  typeof value === "string" && value.length > 0 && value.length <= maxLength;

const parseAmount = (amount) => {
  const raw =
    typeof amount === "number"
      ? amount.toFixed(2)
      : typeof amount === "string"
        ? amount.trim()
        : "";

  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = amountToCents(raw);
  if (cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  return { normalized: raw, cents };
};

const parseDate = (value) => {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.valueOf()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
};

const getIdempotencyEntry = (key) => {
  const cached = idempotencyCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    idempotencyCache.delete(key);
    return null;
  }
  return cached;
};

app.get("/expenses", async (req, res) => {
  const { category, sort } = req.query;
  const filters = [];
  const params = [];

  if (category && category !== "All") {
    const normalizedCategory = normalizeText(category);
    if (!isValidText(normalizedCategory, 64)) {
      return res.status(400).json({ message: "Invalid category." });
    }
    filters.push("category = ?");
    params.push(normalizedCategory);
  }

  const orderBy = sort === "date_desc" ? "date DESC, created_at DESC" : "created_at DESC";
  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const [rows] = await pool.query(
      `SELECT id, amount, category, description, date, created_at FROM expenses ${whereClause} ORDER BY ${orderBy}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /expenses failed:", err.message);
    res.status(500).json({ message: "Failed to load expenses." });
  }
});

app.post("/expenses", async (req, res) => {
  const { amount, category, description, date } = req.body || {};
  const normalizedCategory = normalizeText(category);
  const normalizedDescription = normalizeText(description);
  const parsedAmount = parseAmount(amount);
  const parsedDate = parseDate(date);
  const idempotencyKey = normalizeText(req.get("Idempotency-Key"));

  if (!parsedAmount) {
    return res.status(400).json({ message: "Amount must be a positive decimal." });
  }

  if (!isValidText(normalizedCategory, 64) || !isValidText(normalizedDescription, 255)) {
    return res.status(400).json({ message: "Missing or invalid fields." });
  }

  if (!parsedDate) {
    return res.status(400).json({ message: "Date must be in YYYY-MM-DD format." });
  }

  if (idempotencyKey.length > 128) {
    return res.status(400).json({ message: "Idempotency key too long." });
  }

  const runCreate = async () => {
    // Basic idempotency check: same payload in the last 60 seconds.
    const [existing] = await pool.query(
      `SELECT id, amount, category, description, date, created_at
       FROM expenses
       WHERE description = ? AND amount = ? AND date = ?
         AND created_at >= (NOW() - INTERVAL 60 SECOND)
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedDescription, parsedAmount.normalized, parsedDate]
    );

    if (existing.length) {
      return { status: 200, body: existing[0], cacheable: true };
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO expenses (id, amount, category, description, date)
       VALUES (?, ?, ?, ?, ?)`,
      [id, parsedAmount.normalized, normalizedCategory, normalizedDescription, parsedDate]
    );

    const [rows] = await pool.query(
      `SELECT id, amount, category, description, date, created_at
       FROM expenses
       WHERE id = ?`,
      [id]
    );

    return { status: 201, body: rows[0], cacheable: true };
  };

  try {
    if (idempotencyKey) {
      const cached = getIdempotencyEntry(idempotencyKey);
      if (cached) {
        return res.status(cached.status).json(cached.body);
      }

      if (idempotencyLocks.has(idempotencyKey)) {
        const result = await idempotencyLocks.get(idempotencyKey);
        return res.status(result.status).json(result.body);
      }

      const promise = runCreate();
      idempotencyLocks.set(idempotencyKey, promise);
      const result = await promise;
      idempotencyLocks.delete(idempotencyKey);

      if (result.cacheable) {
        idempotencyCache.set(idempotencyKey, {
          status: result.status,
          body: result.body,
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
        });
      }

      return res.status(result.status).json(result.body);
    }

    const result = await runCreate();
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("POST /expenses failed:", err.message);
    if (err.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({ message: "Database schema missing." });
    }
    if (err.code === "ER_BAD_DB_ERROR") {
      return res.status(500).json({ message: "Database not found." });
    }
    return res.status(500).json({ message: "Failed to save expense." });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ message: "Invalid JSON payload." });
  }
  return next(err);
});

const port = Number(process.env.PORT || 4001);
const currentFile = fileURLToPath(import.meta.url);

if (process.env.NODE_ENV !== "test" && process.argv[1] === currentFile) {
  app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });
}

export { app, idempotencyCache, idempotencyLocks, pool };
