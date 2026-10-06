/** Supplemental real-API checks; failures are collected so other features continue. */
export async function runCoverageScenarios(ctx) {
  const results = [];
  const req = async (role, method, route, body, options) => {
    const response = await ctx.request(
      role,
      method,
      `/api/v1${route}`,
      body,
      options,
    );
    if (!response.ok && !options?.expected)
      throw new Error(`${method} ${route}: ${response.status}`);
    return response.body;
  };
  const feature = async (name, work) => {
    try {
      const details = await work();
      results.push({
        name,
        status: details?.partial ? "partial" : "proven",
        details,
      });
    } catch (error) {
      results.push({
        name,
        status: "failed",
        message: String(error.message ?? error),
      });
    }
  };
  const requireCheck = (name, condition, details) => {
    ctx.check?.(name, condition, details);
    if (!condition) throw new Error(name);
  };
  const date = ctx.simDate?.slice(0, 10) ?? "2026-09-22";
  const occurredAt = `${date}T20:00:00+05:30`;
  const key = (suffix) => `${ctx.runId}-extra-${suffix}`;
  const state = ctx.operations;
  if (!state)
    throw new Error("Operations setup is required for supplemental coverage");
  let lotBlock;

  await feature("Operator cannot provision staff", async () => {
    await req(
      "operator",
      "POST",
      "/admin/users",
      { username: key("denied-user"), role: "operator" },
      { expected: 403 },
    );
    return { expectedStatus: 403 };
  });
  await feature("Owner cannot demote own login", async () => {
    const me = await req("owner", "GET", "/auth/me");
    const username = me.username ?? me.user?.username;
    if (!username)
      throw new Error("Authenticated owner username not available");
    await req(
      "owner",
      "POST",
      "/admin/users",
      { username, role: "operator" },
      { expected: 403 },
    );
    return { expectedStatus: 403 };
  });
  await feature("Accountant cannot post factory expense", async () => {
    await req(
      "accountant",
      "POST",
      "/expenses",
      {
        category: "other",
        amount: 1,
        expenseDate: date,
        clientOpId: key("accountant-denied"),
      },
      { expected: 403 },
    );
    return {
      expectedStatus: 403,
      note: "Current accountant role is read-only",
    };
  });
  await feature("Body factory injection cannot change tenant", async () => {
    const item = await req("supervisor", "POST", "/consumables", {
      name: key("tenant-check"),
      unit: "piece",
      onHand: 0,
      factoryId: ctx.originalFactoryIds?.[0] ?? "foreign-factory",
    });
    requireCheck(
      "Injected body factory ignored",
      item.factoryId === ctx.factoryId,
      { returnedFactoryId: item.factoryId },
    );
    const list = await req("supervisor", "GET", "/consumables");
    requireCheck(
      "Consumables list is tenant scoped",
      list.every((row) => row.factoryId === ctx.factoryId),
      { count: list.length },
    );
    return { itemId: item.id, scope: "authenticated demo factory" };
  });
  await feature("Consumable overdraw preserves balance", async () => {
    const item = state.consumables[0];
    const before = (await req("supervisor", "GET", "/consumables")).find(
      (row) => row.id === item.id,
    );
    await req(
      "supervisor",
      "POST",
      `/consumables/${item.id}/movements`,
      {
        direction: "usage",
        quantity: 100000000,
        reason: "Demo deliberate overdraw",
        occurredOn: date,
        clientOpId: key("overdraw"),
      },
      { expected: 400 },
    );
    const after = (await req("supervisor", "GET", "/consumables")).find(
      (row) => row.id === item.id,
    );
    requireCheck(
      "Rejected overdraw unchanged",
      Number(before.onHand) === Number(after.onHand),
      { before: before.onHand, after: after.onHand },
    );
    return { expectedStatus: 400, unchanged: true };
  });
  await feature("Attachment upload/read round trip", async () => {
    const content = `StoneOS synthetic dry-run ${ctx.runId}`;
    const file = await req("supervisor", "POST", "/files", {
      fileName: key("attachment.txt"),
      contentType: "text/plain",
      base64: Buffer.from(content).toString("base64"),
    });
    const read = await req("supervisor", "GET", `/files/${file.id}`);
    requireCheck(
      "Attachment bytes round trip",
      Buffer.from(read.base64, "base64").toString() === content,
      { fileId: file.id },
    );
    const list = await req("supervisor", "GET", "/files");
    requireCheck(
      "Attachment listed in own factory",
      list.some((item) => item.id === file.id) &&
        list.every((item) => item.factoryId === ctx.factoryId),
      { count: list.length },
    );
    await req(
      "supervisor",
      "POST",
      "/files",
      {
        fileName: "invalid-target.png",
        contentType: "image/png",
        base64: "AA==",
        entityType: "block",
        entityId: "00000000-0000-4000-8000-000000000001",
      },
      { expected: 400 },
    );
    return { fileId: file.id, attachmentTargetRejection: 400 };
  });
  await feature("Opening stock safeguards", async () => {
    const factory = await req("owner", "GET", "/factory/me");
    await req("inventory", "GET", "/inventory/opening");
    if (factory.operatingStatus === "LIVE") {
      await req(
        "inventory",
        "POST",
        "/inventory/opening",
        {},
        { expected: 400 },
      );
      return {
        partial: true,
        expectedStatus: 400,
        reason:
          "Factory already live; creating another opening is correctly forbidden. Positive opening approval requires a separate pre-live factory.",
      };
    }
    const snapshot = await req("inventory", "POST", "/inventory/opening", {});
    await req("supervisor", "POST", `/inventory/opening/${snapshot.id}/lines`, {
      kind: "RAW_BLOCK",
      payload: {
        serialNumber: key("opening"),
        varietyName: "Kotda black",
        weightTons: "20",
      },
    });
    await req(
      "supervisor",
      "POST",
      `/inventory/opening/${snapshot.id}/submit`,
      {},
    );
    await req("owner", "POST", `/inventory/opening/${snapshot.id}/approve`, {});
    return {
      snapshotId: snapshot.id,
      separationOfDuties: "Supervisor enters, owner approves",
    };
  });
  await feature(
    "Lot count cut, three passes and broken stock writeoff",
    async () => {
      const serial = key("LOT");
      const receipt = await req("inventory", "POST", "/inventory/raw-blocks", {
        serialNumber: serial,
        varietyName: "Kotda black",
        supplierId: state.supplier.id,
        weightTons: 20,
        blockPricePerTon: 10000,
        purchaseTaxable: 200000,
        gstRatePct: 5,
        invoicedAmount: 210000,
        actualAmountPaid: 0,
        clientOpId: key("lot-receipt"),
        occurredAt,
      });
      lotBlock = receipt.block ?? receipt;
      const body = {
        blockSerial: serial,
        totalSlabsCut: 56,
        damagedAtSaw: 1,
        sqftPerSlab: 40,
        clientOpId: key("lot-cut"),
      };
      const cut = await req("supervisor", "POST", "/lots/cut", body);
      const again = await req("supervisor", "POST", "/lots/cut", body);
      requireCheck(
        "Lot cut retry preserves count",
        cut.availableSlabs === again.availableSlabs &&
          cut.availableSlabs === 55,
        { first: cut, retry: again },
      );
      for (const processType of ["GRINDING", "RESIN", "POLISHING"]) {
        const polish = await req("supervisor", "POST", "/lots/polish", {
          blockSerial: serial,
          slabCount: 55,
          machineId: state.polishing.id,
          processType,
          finishType:
            processType === "POLISHING"
              ? "polished"
              : processType.toLowerCase(),
          runtimeHours: 2,
          downtimeMinutes: 5,
          occurredAt,
          clientOpId: key(`lot-${processType}`),
        });
        requireCheck(
          `Lot ${processType} keeps stock`,
          polish.availableSlabs === 55,
          polish,
        );
      }
      const broken = await req("inventory", "POST", "/lots/write-off", {
        blockSerial: serial,
        slabCount: 1,
        stage: "yard",
        reason: "Demo corner cracked during internal transfer",
        occurredOn: date,
        clientOpId: key("lot-break"),
      });
      requireCheck(
        "One broken lot piece deducted",
        broken.availableSlabs === 54,
        broken,
      );
      await req(
        "inventory",
        "POST",
        "/lots/write-off",
        {
          blockSerial: serial,
          slabCount: 10000,
          stage: "yard",
          reason: "Demo invalid count",
          occurredOn: date,
          clientOpId: key("lot-break-too-many"),
        },
        { expected: 400 },
      );
      return {
        serial,
        available: 54,
        area: 2160,
        brokenCost: broken.costAmount,
      };
    },
  );
  await feature(
    "Lot sale, partial dispatch, invoice retries and stock invariance",
    async () => {
      if (!lotBlock) throw new Error("Lot setup failed");
      const customers = await req("sales", "GET", "/customers");
      const customer =
        (Array.isArray(customers) ? customers : (customers.items ?? [])).find(
          (item) => item.factoryId === ctx.factoryId,
        ) ?? customers[0];
      if (!customer) throw new Error("No synthetic customer found");
      const serial = lotBlock.serialNumber;
      const saleBody = {
        customerId: customer.id,
        orderDate: date,
        lines: [
          { blockSerial: serial, slabCount: 10, rate: 180, gstRatePct: 18 },
        ],
        clientOpId: key("lot-sale"),
      };
      const sale = await req("owner", "POST", "/lots/sell", saleBody);
      const replay = await req("owner", "POST", "/lots/sell", saleBody);
      const orderId = sale.orderId ?? sale.id;
      requireCheck(
        "Lot sale retry has one order",
        orderId === (replay.orderId ?? replay.id),
        { orderId },
      );
      const available = async () =>
        (await req("sales", "GET", "/lots/available")).lots.find(
          (lot) => lot.blockSerial === serial,
        )?.availableSlabs ?? 0;
      requireCheck("Lot sale deducts ten once", (await available()) === 44, {
        expected: 44,
      });
      const firstBody = {
        orderId,
        lines: [{ blockSerial: serial, slabCount: 4 }],
        occurredAt,
        clientOpId: key("lot-dispatch1"),
      };
      await req("owner", "POST", "/lots/dispatch", firstBody);
      await req("owner", "POST", "/lots/dispatch", firstBody);
      requireCheck(
        "Partial dispatch does not deduct stock twice",
        (await available()) === 44,
        { expected: 44 },
      );
      const pending = await req("sales", "GET", "/lots/pending-dispatch");
      requireCheck(
        "Partial dispatch leaves six pending",
        pending
          .find((item) => item.orderId === orderId)
          ?.lots.find((item) => item.blockSerial === serial)?.stillToGo === 6,
        { orderId },
      );
      await req("owner", "POST", "/lots/dispatch", {
        orderId,
        lines: [{ blockSerial: serial, slabCount: 6 }],
        occurredAt,
        clientOpId: key("lot-dispatch2"),
      });
      const invoiceBody = {
        orderId,
        invoiceDate: date,
        clientOpId: key("lot-invoice"),
      };
      const invoice = await req("owner", "POST", "/lots/invoice", invoiceBody);
      const retry = await req("owner", "POST", "/lots/invoice", invoiceBody);
      requireCheck(
        "Lot invoice retry stable",
        (invoice.id ?? invoice.invoiceId) === (retry.id ?? retry.invoiceId),
        { orderId },
      );
      requireCheck(
        "Dispatch/invoice preserve sold stock",
        (await available()) === 44,
        { expected: 44 },
      );
      return {
        orderId,
        invoiceId: invoice.invoiceId ?? invoice.id,
        partialPendingCount: 6,
      };
    },
  );
  await feature("Machine standards and block cost review", async () => {
    for (const machine of [state.cutting, state.polishing])
      await req(
        "owner",
        "POST",
        `/reports/analytics/machines/${machine.id}/standard`,
        { plannedHoursPerDay: 20, idealSqftPerHour: 220 },
      );
    const blocks = await req("inventory", "GET", "/inventory/raw-blocks");
    const block = blocks.find((item) =>
      item.serialNumber?.startsWith(`DEMO-${ctx.runId}-`),
    );
    if (!block) throw new Error("No manufactured block to review");
    await req("owner", "POST", `/reports/analytics/blocks/${block.id}/rates`, {
      blockPricePerTon: 10000,
      royaltyPerTon: 400,
      transportPerTon: 700,
    });
    const confirmed = await req(
      "owner",
      "POST",
      `/reports/analytics/blocks/${block.id}/costs`,
      { confirmed: true },
    );
    await req(
      "supervisor",
      "POST",
      `/reports/analytics/blocks/${block.id}/rates`,
      { blockPricePerTon: 10000, royaltyPerTon: 400, transportPerTon: 700 },
      { expected: 403 },
    );
    return { blockId: block.id, confirmed };
  });
  await feature("Invalid inventory reversal and movement scope", async () => {
    const movements = await req("inventory", "GET", "/inventory/movements");
    requireCheck(
      "Inventory movements stay in synthetic factory",
      movements.every((item) => item.factoryId === ctx.factoryId),
      { count: movements.length },
    );
    await req(
      "inventory",
      "POST",
      "/inventory/movements/00000000-0000-4000-8000-000000000001/reverse",
      { reason: "Demo invalid movement", clientOpId: key("invalid-reversal") },
      { expected: 404 },
    );
    return { count: movements.length, expectedStatus: 404 };
  });
  await feature(
    "Unused zero-value raw receipt reversal and retry",
    async () => {
      const serial = key("REVERSAL");
      const receipt = await req("inventory", "POST", "/inventory/raw-blocks", {
        serialNumber: serial,
        varietyName: "Cotton white",
        weightTons: 20,
        purchaseTaxable: 0,
        gstRatePct: 0,
        qualityNote: "Demo erroneous zero-value receipt for reversal check",
        clientOpId: key("reverse-receipt"),
        occurredAt,
      });
      const block = receipt.block ?? receipt;
      const movements = await req("inventory", "GET", "/inventory/movements");
      const movement = movements.find(
        (row) =>
          row.rawBlockId === block.id && row.movementType === "GOODS_RECEIPT",
      );
      if (!movement)
        throw new Error("New reversible receipt movement not returned");
      const body = {
        reason: "Demo duplicate truck intake entered in error",
        clientOpId: key("reverse-valid"),
      };
      await req(
        "inventory",
        "POST",
        `/inventory/movements/${movement.id}/reverse`,
        body,
      );
      await req(
        "inventory",
        "POST",
        `/inventory/movements/${movement.id}/reverse`,
        body,
      );
      const blocks = await req("inventory", "GET", "/inventory/raw-blocks");
      requireCheck(
        "Receipt reversal voids only unused block",
        blocks.find((row) => row.id === block.id)?.currentStatus === "voided",
        { blockId: block.id },
      );
      return {
        blockId: block.id,
        status: "voided",
        financialImpact: 0,
        retry: "same operation reference",
      };
    },
  );
  ctx.report.extraCoverage = results;
  return results;
}
