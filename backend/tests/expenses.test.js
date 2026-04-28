import { jest } from "@jest/globals";
import request from "supertest";

const mockQuery = jest.fn();
const mockGetConnection = jest.fn().mockResolvedValue({ release: jest.fn() });

const loadApp = async () => {
  jest.resetModules();
  mockQuery.mockReset();
  mockGetConnection.mockClear();

  await jest.unstable_mockModule("mysql2/promise", () => ({
    default: {
      createPool: () => ({
        query: mockQuery,
        getConnection: mockGetConnection
      })
    }
  }));

  const module = await import("../server.js");
  return module.app;
};

describe("/expenses", () => {
  test("rejects invalid amount", async () => {
    const app = await loadApp();
    const response = await request(app).post("/expenses").send({
      amount: "-2",
      category: "Food",
      description: "Test",
      date: "2024-01-01"
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/amount/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("rejects invalid date", async () => {
    const app = await loadApp();
    const response = await request(app).post("/expenses").send({
      amount: "12.00",
      category: "Food",
      description: "Test",
      date: "2024-13-40"
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/date/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("returns expenses list", async () => {
    const app = await loadApp();
    mockQuery.mockResolvedValueOnce([
      [
        {
          id: "1",
          amount: "10.00",
          category: "Food",
          description: "Lunch",
          date: "2024-01-01",
          created_at: "2024-01-01T00:00:00.000Z"
        }
      ]
    ]);

    const response = await request(app).get("/expenses?sort=date_desc");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].description).toBe("Lunch");
  });

  test("uses idempotency key cache", async () => {
    const app = await loadApp();

    mockQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([
        [
          {
            id: "abc",
            amount: "10.00",
            category: "Food",
            description: "Snack",
            date: "2024-01-01",
            created_at: "2024-01-01T00:00:00.000Z"
          }
        ]
      ]);

    const payload = {
      amount: "10.00",
      category: "Food",
      description: "Snack",
      date: "2024-01-01"
    };

    const first = await request(app)
      .post("/expenses")
      .set("Idempotency-Key", "abc")
      .send(payload);

    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/expenses")
      .set("Idempotency-Key", "abc")
      .send(payload);

    expect(second.status).toBe(201);
    expect(second.body.id).toBe("abc");
  });
});
