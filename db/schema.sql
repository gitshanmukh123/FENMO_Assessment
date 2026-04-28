CREATE DATABASE IF NOT EXISTS fenmo_expenses;
USE fenmo_expenses;

CREATE TABLE IF NOT EXISTS expenses (
  id CHAR(36) PRIMARY KEY,
  amount DECIMAL(10, 2) NOT NULL,
  category VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_expenses_dedupe (description, amount, date, created_at)
);
