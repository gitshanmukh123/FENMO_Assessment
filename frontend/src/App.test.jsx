import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App.jsx";

const mockExpenses = [
  {
    id: "1",
    amount: "12.50",
    category: "Food",
    description: "Lunch",
    date: "2024-01-01",
    created_at: "2024-01-01T00:00:00.000Z"
  }
];

describe("App", () => {
  it("renders expenses", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockExpenses)
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Lunch")).toBeInTheDocument();
    });
  });

  it("shows error when fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: "Failed" })
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeInTheDocument();
    });
  });
});
