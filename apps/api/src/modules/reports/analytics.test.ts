import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocationShares,
  baselineForecast,
  equipmentMetrics,
  invoiceBalance,
  minor,
} from "./analytics-math";
import {
  OpenaiService,
  encryptProviderKey,
  decryptProviderKey,
} from "./openai.service";
describe("analytics accounting and production", () => {
  it("subtracts only payments and credits known at the report date", () => {
    assert.equal(
      invoiceBalance(
        {
          amount: 1000,
          payments: [
            { amount: 200, paidAt: "2026-01-02" },
            { amount: 300, paidAt: "2026-02-02" },
          ],
          creditNotes: [{ amount: 100, createdAt: "2026-01-10" }],
        },
        "2026-01-31",
      ),
      70000,
    );
  });
  it("preserves every paise across uneven allocation", () => {
    assert.deepEqual(allocationShares(100, [1, 1, 1]), [34, 33, 33]);
    assert.equal(
      allocationShares(minor(123.45), [2, 7, 11]).reduce((a, b) => a + b, 0),
      12345,
    );
    assert.deepEqual(allocationShares(123, [0, 1]), [0, 123]);
  });
  it("counts rejected output once in OEE", () => {
    const m = equipmentMetrics(8, 120, 720, 800, 10, 100, 1);
    assert.equal(m.availability, 0.8);
    assert.equal(m.performance, 1);
    assert.equal(m.quality, 0.9);
    assert.ok(Math.abs(m.oee! - 0.72) < 1e-10);
    assert.equal(equipmentMetrics(8, 0, 720, 800, null, 100, 1).oee, null);
    assert.equal(equipmentMetrics(12, 0, 1200, 1200, 8, 100, 1).oee, null);
  });
  it("withholds forecasts until three complete months exist", () => {
    const rows = [
      { month: "2026-01", collections: 100, soldSqft: 10 },
      { month: "2026-02", collections: 200, soldSqft: 20 },
      { month: "2026-03", collections: 300, soldSqft: 30 },
      { month: "2026-04", collections: 400, soldSqft: 40 },
    ];
    assert.equal(baselineForecast(rows, "2026-01-01", "2026-03").ready, false);
    const f = baselineForecast(rows, "2026-01-01", "2026-04");
    assert.equal(f.collections?.baseline, 300);
    assert.equal(f.collections?.lower, 200);
  });
});
describe("OpenAI boundaries", () => {
  it("encrypts keys with authenticated encryption and rejects a changed secret", () => {
    const key = "sk-test-not-a-real-provider-key";
    const encrypted = encryptProviderKey(key, "private-server-secret");
    assert.ok(!encrypted.includes(key));
    assert.equal(decryptProviderKey(encrypted, "private-server-secret"), key);
    assert.throws(() => decryptProviderKey(encrypted, "wrong-secret"));
  });
  it("uses Responses structured output, disables storage and accepts only this factory sources", async () => {
    const oldFetch = globalThis.fetch,
      oldKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-local-only";
    let body: any;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    answer: "Recorded collections: 20",
                    sourceIds: ["collections-summary"],
                    limitations: ["Recorded data only"],
                  }),
                },
              ],
            },
          ],
        }),
      );
    };
    const snapshot = {
      alerts: [],
      pendingOrders: [],
      varieties: [],
      briefing: [{ source: "collections-summary" }],
      sources: [
        {
          id: "collections-summary",
          label: "Collections",
          url: "/sales/reports",
        },
      ],
      stock: [],
      blockCosts: [],
      customers: [],
      suppliers: [],
      collectionPriority: [],
      collections: { invoices: [] },
      generatedAt: "2026-10-04",
    };
    const ai = new OpenaiService(
      {} as never,
      { snapshot: async () => snapshot } as never,
      { record: async () => {} } as never,
      {} as never,
    );
    try {
      const answer = await ai.ask({ factoryId: "one", id: "owner" } as never, {
        question: "Collections?",
        language: "hi",
      });
      assert.equal(answer.sources.length, 1);
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, "json_schema");
      assert.match(body.instructions, /Hindi/);
      assert.equal(body.tools, undefined);
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      answer: "Fake",
                      sourceIds: ["foreign-invoice"],
                      limitations: [],
                    }),
                  },
                ],
              },
            ],
          }),
        );
      await assert.rejects(
        () =>
          ai.ask({ factoryId: "one", id: "owner" } as never, {
            question: "Dues?",
          }),
        /unavailable records/,
      );
    } finally {
      globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
    }
  });
  it("does not upload malformed extraction output or leak provider errors", async () => {
    const ai = new OpenaiService(
      {} as never,
      {} as never,
      {} as never,
      {
        upload: () => {
          throw Error("must not upload");
        },
      } as never,
    );
    ai.structured = async () => ({
      kind: "supplier_bill",
      lines: [],
      uncertainFields: [],
      total: -1,
    });
    await assert.rejects(
      () =>
        ai.extract({ factoryId: "one", id: "owner" } as never, {
          fileName: "bill.png",
          contentType: "image/png",
          base64: Buffer.from("fixture").toString("base64"),
        }),
      /unusable/,
    );
  });
});
