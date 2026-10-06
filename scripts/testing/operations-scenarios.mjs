/** Real REST operations scenarios. No service startup, database seed or public-host writes. */
export const CONSUMABLE_SCENARIO = [
  {
    key: "epoxy",
    name: "Demo epoxy resin",
    unit: "litre",
    per1000Sqft: 12,
    price: 650,
  },
  {
    key: "abrasives",
    name: "Demo LPM abrasives",
    unit: "piece",
    per1000Sqft: 8,
    price: 180,
  },
  {
    key: "segments",
    name: "Demo diamond segments",
    unit: "piece",
    per1000Sqft: 2,
    price: 850,
  },
  {
    key: "oil",
    name: "Demo lubricating oil",
    unit: "litre",
    per1000Sqft: 1,
    price: 320,
  },
  {
    key: "grease",
    name: "Demo grease cartridge",
    unit: "piece",
    per1000Sqft: 0.5,
    price: 280,
  },
  {
    key: "converter",
    name: "Demo colour converter",
    unit: "litre",
    per1000Sqft: 0.75,
    price: 950,
  },
  {
    key: "blades",
    name: "Demo saw blade",
    unit: "piece",
    per1000Sqft: 0.02,
    price: 18000,
  },
  {
    key: "hardener",
    name: "Demo resin hardener",
    unit: "litre",
    per1000Sqft: 3,
    price: 700,
  },
  {
    key: "pads",
    name: "Demo finishing pads",
    unit: "piece",
    per1000Sqft: 1,
    price: 450,
  },
];

const VARIETIES = [
  "Kotda black",
  "R black",
  "P white",
  "Bhimana white",
  "Nadol white",
  "Ice white",
  "Khalda red",
  "Apple brown",
  "Cotton white",
  "Apple gold",
  "Chima pink",
  "Madka black",
  "Cat eyes",
  "Coin black",
];
const q3 = (value) => Math.round(value * 1000) / 1000;
const money = (value) => Math.round(value * 100) / 100;
const at = (date, hour = 12) =>
  `${date}T${String(hour).padStart(2, "0")}:00:00+05:30`;

/** Twenty-two production days, deliberately independent of weekends/holidays. */
export function buildYearPlan({
  startMonth = "2025-10",
  months = 12,
  workingDays = 22,
} = {}) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > 12 ||
    !Number.isInteger(workingDays) ||
    workingDays < 1 ||
    workingDays > 22
  ) {
    throw new Error(
      "Use a valid start month, 1–12 months and 1–22 production days",
    );
  }
  const [year, month] = startMonth.split("-").map(Number);
  const plan = [];
  for (let index = 0; index < months; index += 1) {
    const stamp = new Date(Date.UTC(year, month - 1 + index, 1))
      .toISOString()
      .slice(0, 7);
    const days = Array.from({ length: workingDays }, (_, offset) => ({
      date: `${stamp}-${String(offset + 1).padStart(2, "0")}`,
      month: stamp,
      monthIndex: index,
      dayIndex: offset,
      area: 4400,
      pieceArea: 40,
      goodPieces: 110,
      blockCount: 2,
      tons: 40,
      recoverySqftPerTon: 110,
      salesTargetSqft: [80000, 88000, 96000][index % 3],
    }));
    plan.push({
      month: stamp,
      monthIndex: index,
      days,
      area: days.length * 4400,
      tons: days.length * 40,
      salesTargetSqft: days[0].salesTargetSqft,
    });
  }
  return plan;
}

async function call(ctx, role, method, path, body, options) {
  const response = await ctx.request(
    role,
    method,
    `/api/v1${path}`,
    body,
    options,
  );
  if (!response.ok && !options?.expected)
    throw new Error(`${role}: ${method} ${path} returned ${response.status}`);
  return response.body;
}

export async function setupOperations(ctx) {
  const machines = await call(ctx, "operator", "GET", "/machines");
  const cutting =
    machines.find(
      (item) => item.machineType === "CUTTING" && /B.?21/i.test(item.name),
    ) ?? machines.find((item) => item.machineType === "CUTTING");
  const polishing =
    machines.find(
      (item) => item.machineType === "POLISHING" && /LPM/i.test(item.name),
    ) ?? machines.find((item) => item.machineType === "POLISHING");
  if (!cutting || !polishing)
    throw new Error(
      "Seed isolated B21 cutting and LPM polishing machines first",
    );
  const locations = await call(ctx, "inventory", "GET", "/inventory/locations");
  for (const code of ["RAW_YARD", "UNPOLISHED_STOCK", "FINISHED_STOCK"]) {
    if (!locations.some((location) => location.code === code))
      throw new Error(`Missing isolated ${code} location`);
  }
  const supplier = await call(
    ctx,
    "inventory",
    "POST",
    "/inventory/suppliers",
    {
      name: `Demo quarry ${ctx.runId}`,
      stateCode: "08",
      gstin: "08ABCDE1234F1Z5",
      contactInfo: "Synthetic supplier — no real contact",
      billingAddress: "Demo quarry road, Rajasthan",
      shippingAddress: "Demo quarry loading yard",
    },
  );
  const supplyVendor = await call(
    ctx,
    "inventory",
    "POST",
    "/inventory/suppliers",
    {
      name: `Demo factory supplies ${ctx.runId}`,
      stateCode: "08",
      gstin: "08ABCDF1234F1Z5",
      contactInfo: "Synthetic supplier — no real contact",
      billingAddress: "Demo industrial estate, Rajasthan",
    },
  );
  const consumables = [];
  await call(
    ctx,
    "operator",
    "POST",
    "/consumables",
    {
      name: `Forbidden operator supply ${ctx.runId}`,
      unit: "piece",
      onHand: 0,
    },
    { expected: 403 },
  );
  for (const item of CONSUMABLE_SCENARIO) {
    const stock = await call(ctx, "supervisor", "POST", "/consumables", {
      name: `${item.name} ${ctx.runId}`,
      unit: item.unit,
      onHand: 0,
    });
    consumables.push({ ...item, id: stock.id });
  }
  const state = {
    cutting,
    polishing,
    supplier,
    supplyVendor,
    consumables,
    days: [],
    monthsReceived: new Set(),
    operationsCount: 0,
  };
  ctx.operations = state;
  ctx.report.operationsAssumptions = {
    dailySqft: 4400,
    workdaysPerMonth: 22,
    goodRecoverySqftPerTon: 110,
    damagedPiecesPerBlock: 1,
    slabDimensionsFt: [8, 5],
    thicknessMm: 18,
    consumables: CONSUMABLE_SCENARIO,
    procurementLimitation:
      "Receipt/usage stock and paid expense are independent REST records, not a linked purchase order or supplier-credit bill. Rates and consumption are test assumptions, not measured factory standards.",
  };
  return state;
}

async function receiveMonthlySupplies(ctx, day) {
  const state = ctx.operations;
  if (state.monthsReceived.has(day.month)) return;
  const area =
    ctx.plan?.find((item) => item.month === day.month)?.area ?? 96800;
  for (const item of state.consumables) {
    const use = q3((area / 1000) * item.per1000Sqft);
    // Ten percent reserve, with a full physical pack as the minimum purchase.
    const quantity =
      item.unit === "piece" ? Math.ceil(use * 1.1) : q3(use * 1.1);
    const body = {
      direction: "receipt",
      quantity,
      reason: `Demo paid supplies / ${day.month}; ${item.unit === "piece" ? "fractional usage is amortized wear" : "volume usage"}`,
      occurredOn: day.date,
      clientOpId: `${ctx.runId}-supply-${day.month}-${item.key}`,
    };
    const received = await call(
      ctx,
      "supervisor",
      "POST",
      `/consumables/${item.id}/movements`,
      body,
    );
    if (day.monthIndex === 0) {
      const retry = await call(
        ctx,
        "supervisor",
        "POST",
        `/consumables/${item.id}/movements`,
        body,
      );
      ctx.check?.(`Repeat-safe ${item.key} receipt`, received.id === retry.id, {
        movementId: received.id,
      });
    }
    const taxable = money(quantity * item.price);
    await call(ctx, "owner", "POST", "/expenses", {
      category: "consumables",
      amount: money(taxable * 1.18),
      taxableAmount: taxable,
      gstRatePct: 18,
      supplierGstin: state.supplyVendor.gstin,
      toWhom: `${state.supplyVendor.name} / ${item.name} / ${quantity} ${item.unit}`,
      expenseDate: day.date,
      paymentMethod: "bank",
      clientOpId: `${ctx.runId}-supply-paid-${day.month}-${item.key}`,
    });
  }
  state.monthsReceived.add(day.month);
}

export async function runOperationsDay(ctx, day) {
  if (!ctx.operations) throw new Error("Call setupOperations first");
  const state = ctx.operations;
  await receiveMonthlySupplies(ctx, day);
  const slabs = [],
    blockIds = [],
    blocks = [];
  for (let part = 0; part < 2; part += 1) {
    const serial = `DEMO-${ctx.runId}-${day.date.replaceAll("-", "")}-${part + 1}`;
    const body = {
      serialNumber: serial,
      varietyName: VARIETIES[(day.monthIndex * 2 + part) % VARIETIES.length],
      supplierId: state.supplier.id,
      quarry: "Isolated demo quarry",
      weightTons: 20,
      blockPricePerTon: 10000,
      royaltyPerTon: 400,
      transportPerTon: 700,
      purchaseTaxable: 200000,
      gstRatePct: 5,
      invoicedAmount: 210000,
      actualAmountPaid: 0,
      supplierInvoiceNo: `DEMO-Q-${day.date}-${part}`,
      clientOpId: `${ctx.runId}-block-${day.date}-${part}`,
      occurredAt: at(day.date, 8),
    };
    const receipt = await call(
      ctx,
      "inventory",
      "POST",
      "/inventory/raw-blocks",
      body,
    );
    const block = receipt.block ?? receipt;
    if (!block.id) throw new Error(`Raw receipt has no block ID: ${serial}`);
    blocks.push(block);
    blockIds.push(block.id);
    if (day.monthIndex === 0 && day.dayIndex === 0) {
      const replay = await call(
        ctx,
        "inventory",
        "POST",
        "/inventory/raw-blocks",
        body,
      );
      ctx.check?.(
        "Repeat-safe raw receipt",
        (replay.block ?? replay).id === block.id,
        { serial },
      );
    }
    for (const [component, amount, category] of [
      ["royalty", 8000, "other"],
      ["block_transport", 14000, "transport"],
    ]) {
      await call(ctx, "owner", "POST", "/expenses", {
        category,
        amount,
        taxableAmount: amount,
        gstRatePct: 0,
        expenseDate: day.date,
        toWhom: `Demo ${component} ${serial}`,
        paymentMethod: "bank",
        blockCost: { rawBlockId: block.id, costComponent: component },
        clientOpId: `${ctx.runId}-${component}-${day.date}-${part}`,
      });
    }
    const cutting = await call(ctx, "operator", "POST", "/cutting-sessions", {
      rawBlockId: block.id,
      machineId: state.cutting.id,
      expectedSlabCount: 56,
      occurredAt: at(day.date, 8),
    });
    await call(
      ctx,
      "operator",
      "POST",
      `/cutting-sessions/${cutting.id}/day-log`,
      {
        runtimeHours: 10,
        downtimeMinutes: 15,
        downtimeReason: "Demo blade inspection",
        slabsProducedCount: 56,
        notes:
          "Half of the B21 daily production; runtime is machine wall time, not additive across blocks",
        occurredAt: at(day.date, 18),
      },
    );
    const completed = await call(
      ctx,
      "supervisor",
      "POST",
      `/cutting-sessions/${cutting.id}/complete`,
      {
        totalSlabsCut: 56,
        finalGoodSlabCount: 55,
        lengthFt: 8,
        widthFt: 5,
        thicknessMm: 18,
        occurredAt: at(day.date, 18),
      },
    );
    ctx.check?.(
      `Cut output ${serial}`,
      completed.slabs?.length === 55 && completed.damaged === 1,
      { good: completed.slabs?.length, damaged: completed.damaged },
    );
    slabs.push(...completed.slabs);
  }
  for (const processType of ["GRINDING", "RESIN", "POLISHING"]) {
    const polishing = await call(
      ctx,
      "operator",
      "POST",
      "/polishing-sessions",
      {
        machineId: state.polishing.id,
        processType,
        slabIds: slabs.map((slab) => slab.id),
        finishType:
          processType === "POLISHING" ? "polished" : processType.toLowerCase(),
        occurredAt: at(day.date, 19),
      },
    );
    const result = await call(
      ctx,
      "supervisor",
      "POST",
      `/polishing-sessions/${polishing.id}/complete`,
      {},
    );
    ctx.check?.(
      `${day.date} ${processType} completed`,
      result.completed === true &&
        result.sellable === (processType === "POLISHING"),
      result,
    );
  }
  for (const machine of [state.cutting, state.polishing]) {
    await call(ctx, "supervisor", "POST", "/machine-logs", {
      machineId: machine.id,
      runtimeHours: 20,
      downtimeMinutes: 30,
      notes: "Demo two shifts; single machine daily total",
      occurredAt: at(day.date, 21),
    });
  }
  for (const item of state.consumables) {
    await call(ctx, "supervisor", "POST", `/consumables/${item.id}/movements`, {
      direction: "usage",
      quantity: q3((day.area / 1000) * item.per1000Sqft),
      reason: `Demo B21/LPM ${day.area} sqft / ${day.date}; fractional pieces represent amortized tool wear`,
      occurredOn: day.date,
      clientOpId: `${ctx.runId}-usage-${day.date}-${item.key}`,
    });
  }
  if (day.dayIndex === 21) {
    for (const machine of [state.cutting, state.polishing]) {
      const job = await call(ctx, "supervisor", "POST", "/maintenance", {
        machineId: machine.id,
        title: `Demo monthly inspection ${day.month}`,
        dueOn: day.date,
        notes: "Inspect bearings, blade segments, abrasives and lubrication",
      });
      await call(
        ctx,
        "supervisor",
        "POST",
        `/maintenance/${job.id}/reschedule`,
        { dueOn: day.date, reason: "Demo review retains scheduled date" },
      );
      const body = {
        occurredAt: at(day.date, 22),
        clientOpId: `${ctx.runId}-maintenance-${job.id}`,
      };
      const done = await call(
        ctx,
        "supervisor",
        "POST",
        `/maintenance/${job.id}/complete`,
        body,
      );
      const again = await call(
        ctx,
        "supervisor",
        "POST",
        `/maintenance/${job.id}/complete`,
        body,
      );
      ctx.check?.(
        "Maintenance repeated completion is stable",
        done.completedAt === again.completedAt,
        { jobId: job.id },
      );
    }
    await call(ctx, "operator", "GET", "/maintenance/alerts");
  }
  const area = slabs.reduce(
    (sum, slab) => sum + Number(slab.lengthFt) * Number(slab.widthFt),
    0,
  );
  ctx.check?.(`${day.date} good recovery`, area === 4400 && area / 40 === 110, {
    area,
    tons: 40,
    ratio: area / 40,
  });
  const result = {
    slabIds: slabs.map((slab) => slab.id),
    slabs,
    area,
    blockIds,
    blocks,
    day,
    date: day.date,
    tons: 40,
    damaged: 2,
    cuttingMachineId: state.cutting.id,
    polishingMachineId: state.polishing.id,
  };
  state.days.push({
    date: day.date,
    area,
    tons: 40,
    slabs: slabs.length,
    damaged: 2,
  });
  return result;
}
