/** Synthetic business users. Caller must enforce the explicitly authorized test-factory allowlist. */
export function createFinanceAgent(ctx) {
  const { request, check, runId } = ctx;
  const api = (role, method, route, body, options) =>
    request(role, method, `/api/v1/${route}`, body, options);
  const state = {
    customers: [],
    workers: [],
    stock: [],
    months: [],
    invoices: [],
    firstInvoice: null,
  };
  const money = (n) => Math.round(Number(n) * 100) / 100;
  const op = (s) => `${runId}-finance-${s}`;
  async function setup() {
    await api("owner", "POST", "gst/profile", {
      gstin: "08ABCDE1234F1Z5",
      legalName: `Synthetic Granite ${runId}`,
      stateCode: "08",
      irpSandbox: true,
    });
    for (const [name, gstin, stateCode] of [
      ["Local consumer", undefined, "08"],
      ["Local dealer", "08FGHIJ5678K1Z5", "08"],
      ["Interstate buyer", "27FGHIJ5678K1Z5", "27"],
    ]) {
      const r = await api("sales", "POST", "customers", {
        name: `DEMO ${runId} ${name}`,
        gstin,
        stateCode,
        contactInfo: "Synthetic contact",
        billingAddress: "Synthetic address, no real customer",
        shippingAddress: "Synthetic factory delivery",
      });
      state.customers.push(r.body);
      await api("sales", "PATCH", `customers/${r.body.id}`, {
        contactInfo: "Synthetic updated contact",
      });
    }
    const supplier = await api("inventory", "POST", "inventory/suppliers", {
      name: `DEMO ${runId} Finished Supplier`,
      gstin: "08PQRST1234A1Z5",
      stateCode: "08",
      billingAddress: "Synthetic supply yard",
    });
    state.supplier = supplier.body;
    await api(
      "inventory",
      "PATCH",
      `inventory/suppliers/${state.supplier.id}`,
      { contactInfo: "Synthetic supplier details updated" },
    );
    for (const kind of ["cutter", "polisher", "helper", "driver"]) {
      state.workers.push(
        (
          await api("owner", "POST", "muster/workers", {
            name: `DEMO ${runId} ${kind}`,
            kind,
            dailyWage: kind === "helper" ? 600 : 900,
          })
        ).body,
      );
    }
    state.vehicle = (
      await api("owner", "POST", "expenses/vehicles", {
        name: `DEMO ${runId} TRUCK`,
      })
    ).body;
    await api("sales", "POST", "quotations", {
      customerId: state.customers[1].id,
      lines: [
        {
          description: "Synthetic granite countertop supply",
          quantitySqft: 1000,
          rate: 180,
        },
      ],
    });
    await api(
      "auditor",
      "POST",
      "expenses",
      {
        category: "other",
        amount: 1,
        expenseDate: "2025-10-01",
        clientOpId: op("denied-expense"),
      },
      { expected: 403 },
    );
    await api(
      "accountant",
      "POST",
      "expenses",
      {
        category: "other",
        amount: 1,
        expenseDate: "2025-10-01",
        clientOpId: op("accountant-denied"),
      },
      { expected: 403 },
    );
    await api("accountant", "GET", "gst/profile", undefined, { expected: 403 });
    await api(
      "operator",
      "POST",
      "muster/workers",
      { name: "DEMO denied worker", dailyWage: 1 },
      { expected: 403 },
    );
    return state;
  }
  async function sale(ids, date, mode, serial) {
    const customer =
      mode === 0 ? state.customers[0] : state.customers[mode === 2 ? 2 : 1];
    const cash = mode === 0 || mode === 4;
    const rate = mode === 2 ? 175 : 180;
    const body = {
      customerId: customer.id,
      orderDate: date,
      clientOpId: op(`order-${serial}`),
      billingMode: cash ? "cash_unbilled" : "gst_invoice",
      lines: ids.map((slabId) => ({ slabId, quantitySqft: 40, rate })),
    };
    const order = (await api("sales", "POST", "sales-orders", body)).body;
    if (!order?.id) throw new Error("Sales order response has no id");
    if (!state.replayedOrder) {
      const replay = await api("sales", "POST", "sales-orders", body);
      check(
        "Sales reservation retry returns same order",
        replay.body?.id === order.id,
        { orderId: order.id },
      );
      state.replayedOrder = true;
    }
    await api("sales", "POST", `sales-orders/${order.id}/packing`, {
      slabIds: ids,
    });
    await api("sales", "POST", `sales-orders/${order.id}/dispatch`, {
      slabIds: ids,
      occurredAt: `${date}T12:00:00+05:30`,
      clientOpId: op(`dispatch-${serial}`),
    });
    if (cash) {
      const input = {
        amount: ids.length * 40 * rate,
        saleDate: date,
        clientOpId: op(`cash-${serial}`),
        buyerName: customer.name,
        note:
          mode === 4
            ? "Cash companion order for separate bill plus cash transaction"
            : "Synthetic local cash sale",
      };
      const r = await api(
        "sales",
        "POST",
        `sales-orders/${order.id}/cash-sale`,
        input,
      );
      if (!state.replayedCash) {
        const again = await api(
          "sales",
          "POST",
          `sales-orders/${order.id}/cash-sale`,
          input,
        );
        check(
          "Cash receipt replay creates no second receipt",
          r.body.id === again.body.id,
          {},
        );
        state.replayedCash = true;
      }
      return {
        sqft: ids.length * 40,
        cash: input.amount,
        invoice: 0,
        received: input.amount,
      };
    }
    const invoice = (
      await api("owner", "POST", `sales-orders/${order.id}/invoice`, {
        clientOpId: op(`invoice-${serial}`),
        invoiceDate: date,
        gstRatePct: 18,
      })
    ).body;
    state.firstInvoice ??= invoice;
    state.invoices.push(invoice);
    const ratio = mode === 1 ? 1 : mode === 2 ? 0.3 : 0.6;
    const amount = money(Number(invoice.amount) * ratio);
    const pay = {
      amount,
      method: ["cash", "bank", "upi", "neft"][state.invoices.length % 4],
      paidAt: date,
      clientOpId: op(`receipt-${serial}`),
    };
    const payment = await api(
      "owner",
      "POST",
      `invoices/${invoice.id}/payments`,
      pay,
    );
    if (!state.replayedPayment) {
      const again = await api(
        "owner",
        "POST",
        `invoices/${invoice.id}/payments`,
        pay,
      );
      check(
        "Invoice payment retry returns same receipt",
        payment.body.id === again.body.id,
        {},
      );
      await api(
        "owner",
        "POST",
        `invoices/${invoice.id}/payments`,
        {
          ...pay,
          amount: Number(invoice.amount) + 1,
          clientOpId: op("overpayment"),
        },
        { expected: 400 },
      );
      state.replayedPayment = true;
    }
    if (!state.returned && mode === 2) {
      const ret = await api(
        "sales",
        "POST",
        `sales-orders/${order.id}/returns`,
        {
          slabIds: [ids[0]],
          reason: "Synthetic customer rejected one countertop",
        },
      );
      check("Invoiced return produces credit note", !!ret.body.creditNote?.id, {
        responseKeys: Object.keys(ret.body ?? {}),
      });
      state.stock.push(ids[0]);
      state.returned = true;
      state.returnedSqft = 40;
    }
    return {
      sqft: ids.length * 40,
      cash: 0,
      invoice: Number(invoice.amount),
      received: amount,
    };
  }
  async function runMonth({ month, date, slabIds, targetSalesSqft }) {
    state.stock.push(...slabIds);
    const count = targetSalesSqft / 40;
    if (!Number.isInteger(count))
      throw new Error("Sales target must be divisible by 40 sqft");
    check(
      `${month} available stock covers target sales`,
      state.stock.length >= count,
      { available: state.stock.length * 40, targetSalesSqft },
    );
    if (state.stock.length < count)
      throw new Error(`Insufficient finished stock in ${month}`);
    const sold = state.stock.splice(0, count);
    const totals = {
      month,
      grossSalesSqft: 0,
      cash: 0,
      invoice: 0,
      received: 0,
    };
    for (let i = 0; i < sold.length; i += 100) {
      const r = await sale(
        sold.slice(i, i + 100),
        date,
        Math.floor(i / 100) % 5,
        `${month}-${i}`,
      );
      totals.grossSalesSqft += r.sqft;
      totals.cash += r.cash;
      totals.invoice += r.invoice;
      totals.received += r.received;
    }
    check(
      `${month} gross sold area meets monthly target`,
      totals.grossSalesSqft === targetSalesSqft,
      totals,
    );
    const finishedInput = {
      reference: op(`FG-${month}`),
      kind: "countertop",
      varietyName: "Black galaxy",
      count: 2,
      lengthFt: 8,
      widthFt: 3,
      thicknessMm: 20,
      finish: "polished",
      supplierId: state.supplier.id,
      invoiceNo: `DEMO-FG-${month}`,
      purchaseDate: date,
      goodsTaxable: 20000,
      gstRatePct: 18,
      paidAmount: 10000,
      paymentMethod: "bank",
      transportTaxable: 1000,
      transportGstRatePct: 18,
      transportPaidAmount: 1180,
      transportPaymentMethod: "upi",
      clientOpId: op(`fg-${month}`),
    };
    const receipt = (
      await api(
        "inventory",
        "POST",
        "inventory/finished-purchases",
        finishedInput,
      )
    ).body;
    check(
      `${month} purchased finished goods bypass raw production`,
      receipt.slabs?.length === 2 &&
        receipt.slabs.every((s) => !s.parentBlockId && !s.cuttingSessionId),
      { receiptId: receipt.id },
    );
    for (const [category, amount] of [
      ["electricity", 300000],
      ["diesel", 90000],
      ["maintenance", 45000],
      ["other", 15000],
    ]) {
      await api("owner", "POST", "expenses", {
        category,
        amount,
        expenseDate: date,
        toWhom: `DEMO ${category} supplier`,
        paymentMethod: "bank",
        clientOpId: op(`${category}-${month}`),
      });
    }
    const monthStart = `${month}-01`;
    const monthEnd = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10);
    for (const worker of state.workers) {
      // Small payroll fixture: 4 workers x 22 scheduled attendance days, not the complete staffing model.
      for (let day = 1; day <= 22; day++)
        await api("supervisor", "POST", "muster/attendance", {
          workerId: worker.id,
          date: `${month}-${String(day).padStart(2, "0")}`,
          status: day === 10 ? "half" : day === 20 ? "ot" : "present",
          otHours: day === 20 ? 2 : 0,
        });
    }
    const sheet = (
      await api("owner", "POST", "muster/sheets", {
        periodStart: monthStart,
        periodEnd: monthEnd,
        clientOpId: op(`payroll-${month}`),
      })
    ).body;
    await api(
      "owner",
      "POST",
      `muster/sheets/${sheet.id}/confirm`,
      {},
      { expected: 403 },
    );
    await api("manager", "POST", `muster/sheets/${sheet.id}/confirm`, {});
    const paid = (
      await api("owner", "POST", `muster/sheets/${sheet.id}/pay`, {
        method: "bank",
      })
    ).body;
    const repeat = (
      await api("owner", "POST", `muster/sheets/${sheet.id}/pay`, {
        method: "bank",
      })
    ).body;
    check(
      `${month} payroll paid once after independent approval`,
      paid.status === "paid" && paid.paidVoucherId === repeat.paidVoucherId,
      { sheetId: sheet.id },
    );
    const trial = (await api("auditor", "GET", "books/trial-balance")).body;
    check(
      `${month} trial balance balances to paise`,
      Math.abs(
        trial.reduce(
          (s, r) =>
            s +
            Math.round(Number(r.debit) * 100) -
            Math.round(Number(r.credit) * 100),
          0,
        ),
      ) === 0,
      {},
    );
    const gst = (await api("owner", "GET", `gst/position?month=${month}`)).body;
    check(
      `${month} GST head balances reconcile input and output`,
      ["cgst", "sgst", "igst"].every(
        (h) =>
          Math.abs(
            Number(gst.net?.[h]) -
              (Number(gst.output?.[h]) - Number(gst.input?.[h])),
          ) < 0.001,
      ),
      {},
    );
    const suppliesInputTax = (
      ctx.report.operationsAssumptions?.consumables ?? []
    ).reduce((sum, item) => {
      const use = Math.round(96.8 * item.per1000Sqft * 1000) / 1000;
      const quantity =
        item.unit === "piece"
          ? Math.ceil(use * 1.1)
          : Math.round(use * 1.1 * 1000) / 1000;
      const taxable = money(quantity * item.price);
      return sum + Math.round(taxable * 0.18 * 100) / 100;
    }, 0);
    const expectedInputTax = money(440000 + 3780 + suppliesInputTax);
    const inputTaxTotal = ["cgst", "sgst", "igst"].reduce(
      (sum, head) => sum + Number(gst.input?.[head] ?? 0),
      0,
    );
    check(
      `${month} rough-block GST input equals known receipt tax plus finished purchase tax`,
      Math.abs(inputTaxTotal - expectedInputTax) < 0.02,
      {
        actualInputTax: inputTaxTotal,
        expectedRawBlockInputTax: 440000,
        expectedFinishedInputTax: 3780,
        expectedSuppliesInputTax: suppliesInputTax,
        rawBlocks: 44,
        eachTaxable: 200000,
        rawGstRatePct: 5,
      },
    );
    await api("owner", "GET", `gst/gstr1?month=${month}`);
    await api(
      "manager",
      "GET",
      `reports/parties?from=${monthStart}&to=${monthEnd}`,
    );
    await api(
      "owner",
      "GET",
      `reports/analytics?from=${monthStart}&to=${monthEnd}`,
    );
    await api("accountant", "GET", `reports/daily?date=${date}`);
    state.months.push(totals);
    return totals;
  }
  async function finish() {
    const date = "2026-09-30";
    const probes = [];
    async function probe(name, task) {
      try {
        const result = await task();
        probes.push({ name, status: "proven", httpStatus: result?.status });
        return result;
      } catch (error) {
        const detail = {
          module: "finance",
          feature: name,
          status: "failed",
          message: String(error?.message ?? error),
        };
        ctx.report.boundaries ??= [];
        ctx.report.boundaries.push(detail);
        probes.push(detail);
        return null;
      }
    }
    for (const route of [
      "books/parties",
      "books/outstanding",
      `books/rokad?date=${date}`,
      "books/collections-today",
      "reports/dashboard",
      "reports/ceo",
      "recovery-ratio",
      "quotations",
      "sales-orders",
      "muster/sheets",
      "expenses",
      "expenses/categories",
      "expenses/vehicles",
      "inventory/finished-purchases",
      "reports/export/blocks.csv",
      "reports/export/slabs.csv",
      "gst/einvoice",
      "gst/eway",
      "gst/rates",
      "reports/analytics/settings",
      "reports/analytics/documents",
      "files",
      "audit",
      "tally/batches",
    ])
      await probe(`Read ${route}`, () => api("owner", "GET", route));
    await probe("Deterministic owner briefing", () =>
      api("owner", "POST", "reports/ceo/ask", {
        question: "What is our outstanding balance?",
      }),
    );
    await probe("OpenAI unconfigured boundary", async () => {
      const result = await api(
        "owner",
        "POST",
        "reports/analytics/ask",
        {
          question: "What are our overdue balances?",
          from: "2026-09-01",
          to: date,
        },
        { expected: 503 },
      );
      ctx.report.boundaries ??= [];
      ctx.report.boundaries.push({
        feature: "Live OpenAI answers",
        status: "partial",
        httpStatus: result.status,
        reason:
          "No provider key configured; boundary response tested, provider answer unverified",
      });
      return result;
    });
    await probe("Derived DPR process counting", async () => {
      const result = await api(
        "owner",
        "GET",
        "dpr?from=2026-09-22T12:00:00Z&to=2026-09-22T12:00:00Z",
      );
      check(
        "DPR counts 110 finished pieces once, not each of three processes",
        Number(result.body.slabsPolished) === 110,
        {
          slabsCut: result.body.slabsCut,
          slabsPolished: result.body.slabsPolished,
          expectedFinishedPieces: 110,
          stages: ["GRINDING", "RESIN", "POLISHING"],
        },
      );
      return result;
    });
    if (state.firstInvoice) {
      await probe("Mock e-invoice", async () => {
        const r = await api(
          "owner",
          "POST",
          `gst/einvoice/${state.firstInvoice.id}`,
          {},
        );
        check(
          "Statutory e-invoice remains clearly mock",
          r.body.source === "mock" && r.body.status === "mock",
          {},
        );
        return r;
      });
      await probe("Mock e-way bill", () =>
        api("owner", "POST", "gst/eway", {
          invoiceId: state.firstInvoice.id,
          clientOpId: op("eway"),
          vehicleId: state.vehicle.id,
          distanceKm: 100,
          fromPin: "306401",
          toPin: "400001",
        }),
      );
      await probe("Collection promise", () =>
        api(
          "owner",
          "POST",
          `reports/analytics/invoices/${state.firstInvoice.id}/terms`,
          {
            dueDate: date,
            promisedPaymentDate: date,
            collectionNote: "Synthetic follow-up promise",
          },
        ),
      );
    }
    const csv = `date,particulars,in,out,mode\n${date},Synthetic office expense,0,500,cash`;
    const draft = await probe("Propose spending intake", () =>
      api("owner", "POST", "intake/drafts", {
        kind: "rokad",
        date,
        fileName: `${op("rokad")}.csv`,
        contentType: "text/csv",
        base64: Buffer.from(csv).toString("base64"),
      }),
    );
    if (draft?.body?.id) {
      await probe("Operator cannot confirm intake", () =>
        api(
          "operator",
          "POST",
          `intake/drafts/${draft.body.id}/confirm`,
          {},
          { expected: 403 },
        ),
      );
      await probe("Independent manager intake confirmation", () =>
        api("manager", "POST", `intake/drafts/${draft.body.id}/confirm`, {}),
      );
    }
    const reject = await probe("Propose rejection fixture", () =>
      api("owner", "POST", "intake/drafts", {
        kind: "rokad",
        date,
        fileName: `${op("reject")}.csv`,
        contentType: "text/csv",
        base64: Buffer.from(
          `${csv}\n${date},Synthetic rejected expense,0,1,cash`,
        ).toString("base64"),
      }),
    );
    if (reject?.body?.id)
      await probe("Reject intake", () =>
        api("manager", "POST", `intake/drafts/${reject.body.id}/reject`, {
          reason: "Synthetic incorrect upload",
        }),
      );
    const proposal = await probe("Journal proposal only", () =>
      api("owner", "POST", "books/copilot/propose", {
        text: "CASH Dr 100\nSALES Cr 100",
        date,
        clientOpId: op("journal-draft"),
      }),
    );
    if (proposal?.body?.id) {
      check(
        "Books assistant creates a proposal only",
        proposal.body.status === "proposed",
        { draftId: proposal.body.id },
      );
      await probe("Reject review-only journal", () =>
        api("manager", "POST", `intake/drafts/${proposal.body.id}/reject`, {
          reason: "Synthetic review-only draft",
        }),
      );
    }
    await probe("Tally daybook import", () =>
      api("owner", "POST", "tally/daybook", {
        fileName: `${op("daybook")}.xml`,
        xml: "<ENVELOPE><BODY><VOUCHER><LEDGERNAME>Synthetic Diesel</LEDGERNAME></VOUCHER></BODY></ENVELOPE>",
      }),
    );
    await probe("Cash drawer lock", () =>
      api("owner", "POST", "books/rokad/lock", { date, countedClose: 0 }),
    );
    ctx.report.finance = {
      months: state.months,
      finishProbes: probes,
      returnedSqft: state.returnedSqft ?? 0,
      remainingManufacturedStockSqft: state.stock.length * 40,
      assumptions: [
        "All manufactured pieces are 40 sqft.",
        "Gross monthly sales target supplied by orchestrator; one 40 sqft return reported separately.",
        "Cash companion and billed sales are separate orders, not one native mixed document.",
        "Four-worker payroll fixture covers attendance and approval; it does not claim full factory labour cost.",
        "Unbilled cash is an existing application mode; statutory treatment is not validated.",
        "E-invoice/eway are mock only.",
        "Persisted accountant/auditor are read-only; owner records financial writes. Manager/admin map to owner; inventory/sales map to supervisor.",
      ],
      gaps: [
        "Later supplier dues settlement has no dedicated API workflow.",
        "Consumable receipt/usage and paid expense are separate, not one purchase/AP bill.",
        "Full COGS accounting lifecycle is absent.",
        "Live OpenAI answers/document parsing require configured key and are unverified.",
        "Khata import totals are pinned to historical cutover; arbitrary synthetic import not claimed.",
      ],
    };
    return ctx.report.finance;
  }
  return { setup, runMonth, finish, state };
}
