import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/current-user";
import { ensureChart } from "./chart";
import { ensureParty, postVoucher, type PostLine } from "./posting";
import { parseBusinessDate, partyNameKey, rupeesToMinor } from "./money";

const text = z.string().trim().min(1).max(200);
const money = z.number().finite().min(0).max(20000000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, "Use at most two decimal places");
const payment = z.object({ kind: z.enum(["funds", "creditor", "vendor_advance", "customer_advance"]), account: text, amount: money.refine(n => n > 0), note: z.string().max(1000).optional() }).strict();
const line = z.object({ variety: text, sqft: z.number().finite().positive().max(1000000).optional(), rate: money.optional(), quantityPending: z.boolean().optional(), sourceAmount: money.optional(), serial: text.optional(), weightTons: z.number().finite().positive().max(100).optional(), stage: z.enum(["finished","rough"]).optional() }).strict();
export const tradeSchema = z.object({
  kind: z.enum(["local_sale", "raw_purchase"]), reference: text, partyName: text,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), clientOpId: text,
  materialAmount: money.refine(n => n > 0), customerAdjustment: money.default(0),
  gstAmount: money.default(0), invoiceTaxable: money.default(0), supplierGstin: z.string().regex(/^[0-9A-Z]{15}$/).optional(),
  quotedWeightTons: z.number().finite().positive().optional(), quotedRate: money.optional(),
  royalty: money.default(0), transport: money.default(0), commission: money.default(0),
  collectionCashAdjustment: money.default(0), note: z.string().max(3000).default(""),
  lines: z.array(line).min(1).max(100), payments: z.array(payment).max(30).default([]),
}).strict();
export type TradeInput = z.input<typeof tradeSchema>;
type Payment = z.infer<typeof payment>;
function canonical(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(canonical);
  if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return input;
}
function hash(input: unknown) { return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex"); }
export function allocateMinor(total: number, weights: number[]) {
  const sum = weights.reduce((a,b) => a+b,0);
  let used = 0;
  return weights.map((w,i) => { const v = i === weights.length-1 ? total-used : Math.floor(total*w/sum); used += v; return v; });
}
function date(value: string) {
  const at = parseBusinessDate(`${value}T02:30:00Z`, "Trade date");
  if (at.toISOString().slice(0,10) !== value) throw new BadRequestException("Invalid calendar date");
  return at;
}
function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new BadRequestException(r.error.issues.map(x => `${x.path.join(".")}: ${x.message}`).join("; "));
  return r.data;
}

@Injectable()
export class TradeService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async funds(factoryId: string) {
    const rows = await this.prisma.ledger.findMany({ where: { factoryId, OR: [{ code: "CASH" }, { code: { startsWith: "FUNDS_" } }] }, include: { lines: true }, orderBy: { name: "asc" } });
    return rows.map(r => ({ code: r.code, name: r.name, balance: r.lines.reduce((s,l) => s+l.debit-l.credit,0)/100 }));
  }
  async ensureFunds(tx: Prisma.TransactionClient, factoryId: string, name: string) {
    if (partyNameKey(name) === "cash") return "CASH";
    const code = "FUNDS_" + hash(partyNameKey(name)).slice(0,16);
    await tx.ledger.upsert({ where: { factoryId_code: { factoryId, code } }, update: {}, create: { factoryId, code, name, group: "asset", kind: "bank", isSystem: false } });
    return code;
  }
  async chart(tx: Prisma.TransactionClient, factoryId: string) {
    await ensureChart(tx, factoryId);
    for (const code of ["CUSTOMER_COLLECTION_CLEARING", "CUSTOMER_ADVANCES"]) {
      await tx.ledger.upsert({ where: { factoryId_code: { factoryId, code } }, update: {}, create: { factoryId, code, name: code === "CUSTOMER_ADVANCES" ? "Customer advances" : "Customer non-material collections", group: "liability", kind: "other", isSystem: false } });
    }
  }
  async list(factoryId: string) {
    const rows = await this.prisma.tradeDocument.findMany({ where: { factoryId }, include: { settlements: true }, orderBy: [{ occurredOn: "desc" }, { reference: "asc" }] });
    return rows.map(r => ({ ...r, outstanding: (rupeesToMinor(Number(r.materialAmount)+Number(r.customerAdjustment)+Number(r.gstAmount)) - r.settlements.reduce((s,p) => s+rupeesToMinor(Number(p.amount)),0))/100 }));
  }
  async destination(tx: Prisma.TransactionClient, user: AuthenticatedUser, p: Payment, customerName: string): Promise<PostLine> {
    const debit = rupeesToMinor(p.amount);
    if (p.kind === "funds") return { ledgerCode: await this.ensureFunds(tx,user.factoryId,p.account), debit, credit: 0 };
    const party = await ensureParty(tx,user.factoryId,p.kind === "customer_advance" ? customerName : p.account,p.kind === "customer_advance" ? "customer" : "supplier");
    if(p.kind !== "customer_advance" && !await tx.supplier.findFirst({where:{factoryId:user.factoryId,name:{equals:p.account,mode:"insensitive"}}})) await tx.supplier.create({data:{factoryId:user.factoryId,name:p.account}});
    const code = p.kind === "creditor" ? "AP" : p.kind === "vendor_advance" ? "SUPPLIER_ADVANCE" : "CUSTOMER_ADVANCES";
    if (p.kind === "creditor" || p.kind === "customer_advance") {
      const sums = await tx.voucherLine.aggregate({ where: { partyId: party.id, ledger: { factoryId: user.factoryId, code } }, _sum: { debit: true, credit: true } });
      if ((sums._sum.credit ?? 0)-(sums._sum.debit ?? 0) < debit) throw new BadRequestException(`Insufficient ${p.kind === "creditor" ? "creditor balance" : "recorded customer advance"} for ${p.account}`);
    }
    return { ledgerCode: code, debit, credit: 0, partyId: party.id };
  }
  async create(user: AuthenticatedUser, raw: unknown) {
    const input = parse(tradeSchema,raw);
    const at = date(input.date);
    const requestHash = hash(input);
    const amount = rupeesToMinor(input.materialAmount), adjustment = rupeesToMinor(input.customerAdjustment), gst = rupeesToMinor(input.gstAmount);
    if (amount+adjustment+gst+rupeesToMinor(input.royalty+input.transport)>2000000000) throw new BadRequestException("Bill exceeds supported voucher limit");
    if (input.kind === "local_sale" && (gst || input.invoiceTaxable || input.royalty || input.transport)) throw new BadRequestException("Local sales do not accept GST or vendor charges");
    if (input.kind === "raw_purchase" && (adjustment || input.commission || input.collectionCashAdjustment || input.invoiceTaxable > input.materialAmount)) throw new BadRequestException("Invalid purchase amounts");
    if (input.kind === "local_sale" && input.lines.some(l => (!l.sqft && !(l.quantityPending && l.sourceAmount)) || l.serial || l.weightTons)) throw new BadRequestException("Sales require sqft or an explicitly pending source quantity");
    if (input.kind === "raw_purchase" && input.lines.some(l => !l.serial || !l.weightTons || l.sqft)) throw new BadRequestException("Purchases require block numbers and weights");
    if (input.kind === "raw_purchase" && input.payments.some(p => p.kind !== "funds")) throw new BadRequestException("Purchase payments require a funds account");
    if (input.payments.reduce((s,p) => s+rupeesToMinor(p.amount),0) > amount+adjustment+gst) throw new BadRequestException("Settlement exceeds bill amount");
    if (input.kind === "raw_purchase" && new Set(input.lines.map(l => l.serial)).size !== input.lines.length) throw new BadRequestException("Duplicate block number");
    return this.prisma.$transaction(async tx => {
      // Serialize writes per factory, including creditor checks and idempotent retries.
      await tx.$queryRaw`SELECT id FROM factory WHERE id=${user.factoryId} FOR UPDATE`;
      const factory = await tx.factory.findUniqueOrThrow({where:{id:user.factoryId}});
      if(factory.goLiveDate && input.date<factory.goLiveDate.toISOString().slice(0,10)) throw new BadRequestException("Trade date precedes factory opening");
      const old = await tx.tradeDocument.findUnique({ where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId: input.clientOpId } }, include: { settlements: true } });
      if (old) { if(old.requestHash !== requestHash) throw new ConflictException("Operation already used with different data"); return old; }
      if(await tx.tradeDocument.findFirst({where:{factoryId:user.factoryId,kind:input.kind,reference:input.reference,partyName:{equals:input.partyName,mode:"insensitive"}}})) throw new ConflictException("This party's bill reference is already recorded");
      await this.chart(tx,user.factoryId);
      const party = await ensureParty(tx,user.factoryId,input.partyName,input.kind === "local_sale" ? "customer" : "supplier");
      if (input.kind === "local_sale") {
        if (!await tx.customer.findFirst({ where: { factoryId:user.factoryId,name:{equals:input.partyName,mode:"insensitive"} } })) await tx.customer.create({data:{factoryId:user.factoryId,name:input.partyName}});
      }
      const document = await tx.tradeDocument.create({ data: { factoryId:user.factoryId,kind:input.kind,reference:input.reference,partyName:input.partyName,occurredOn:at,materialAmount:input.materialAmount,customerAdjustment:input.customerAdjustment,gstAmount:input.gstAmount,invoiceTaxable:input.invoiceTaxable,payload: input as Prisma.InputJsonValue,stockStatus:input.kind === "local_sale" ? "pending_lot_allocation" : "received",requestHash,clientOpId:input.clientOpId,createdBy:user.id } });
      const voucher = (suffix: string, lines: PostLine[], type: "sales"|"purchase"|"receipt"|"payment"|"journal", memo: string) => postVoucher(tx,{factoryId:user.factoryId,type,source:"manual",sourceId:document.id,partyId:party.id,createdBy:user.id,clientOpId:`trade:${input.clientOpId}:${suffix}`,operationalDate:at,memo:`${input.reference} · ${memo}`,lines:lines.filter(l => l.debit || l.credit)});
      if (input.kind === "local_sale") {
        await voucher("bill",[{ledgerCode:"AR",debit:amount+adjustment,credit:0,partyId:party.id},{ledgerCode:"SALES_UNBILLED",debit:0,credit:amount},{ledgerCode:"CUSTOMER_COLLECTION_CLEARING",debit:0,credit:adjustment}],"sales",`Local sale · ${input.partyName}`);
      } else {
        await voucher("bill",[{ledgerCode:"RAW_STOCK",debit:amount,credit:0},{ledgerCode:"GST_INPUT_CGST",debit:Math.floor(gst/2),credit:0},{ledgerCode:"GST_INPUT_SGST",debit:gst-Math.floor(gst/2),credit:0},{ledgerCode:"AP",debit:0,credit:amount+gst,partyId:party.id}],"purchase",`Raw purchase · ${input.partyName}`);
        let supplier = await tx.supplier.findFirst({where:{factoryId:user.factoryId,name:{equals:input.partyName,mode:"insensitive"}}});
        if (!supplier) supplier = await tx.supplier.create({data:{factoryId:user.factoryId,name:input.partyName,gstin:input.supplierGstin,stateCode:"08"}});
        const location = await tx.inventoryLocation.findFirst({where:{factoryId:user.factoryId,code:"RAW_YARD"}});
        if (!location) throw new BadRequestException("Raw yard must be configured");
        const weights = input.lines.map(l => l.weightTons!);
        const taxable = allocateMinor(rupeesToMinor(input.invoiceTaxable),weights), extra = allocateMinor(amount-rupeesToMinor(input.invoiceTaxable),weights), taxes = allocateMinor(gst,weights);
        const royalty = allocateMinor(rupeesToMinor(input.royalty),weights), transport = allocateMinor(rupeesToMinor(input.transport),weights);
        for (let i=0;i<input.lines.length;i++) {
          const l = input.lines[i]!;
          const block = await tx.rawBlock.create({data:{factoryId:user.factoryId,serialNumber:l.serial!,tradeReference:document.id,varietyName:l.variety,supplierId:supplier.id,weightTons:l.weightTons,blockPricePerTon:input.quotedRate,royaltyPerTon:royalty[i]!/100/l.weightTons!,transportPerTon:transport[i]!/100/l.weightTons!,purchaseTaxable:taxable[i]!/100,purchaseCashAmount:extra[i]!/100,purchaseCgst:Math.floor(taxes[i]!/2)/100,purchaseSgst:(taxes[i]!-Math.floor(taxes[i]!/2))/100,purchaseGstRatePct:input.invoiceTaxable ? input.gstAmount/input.invoiceTaxable*100 : 0,supplierInvoiceNo:input.reference,supplierGstin:input.supplierGstin,locationId:location.id,purchaseDate:at,qualityNote:`Trade register ${input.reference}. Liability and payments are posted once on the document. ${input.note}`}});
          await tx.inventoryMovement.create({data:{factoryId:user.factoryId,movementType:"GOODS_RECEIPT",rawBlockId:block.id,quantity:1,idempotencyKey:`trade:${input.clientOpId}:block:${l.serial}`,actorId:user.id,createdAt:at}});
        }
        const costs = rupeesToMinor(input.royalty+input.transport);
        if(costs) await voucher("landed-cost",[{ledgerCode:"RAW_STOCK",debit:costs,credit:0},{ledgerCode:"CASH",debit:0,credit:costs}],"payment","Paid purchase landed costs");
      }
      for(let i=0;i<input.payments.length;i++) {
        const p = input.payments[i]!;
        const settlement = await tx.tradeSettlement.create({data:{documentId:document.id,amount:p.amount,occurredOn:at,payload:p as Prisma.InputJsonValue,clientOpId:`initial:${i}`}});
        const value = rupeesToMinor(p.amount);
        const destination = input.kind === "local_sale" ? await this.destination(tx,user,p,input.partyName) : {ledgerCode:await this.ensureFunds(tx,user.factoryId,p.account),debit:0,credit:value};
        await voucher(`settle:${settlement.id}`,[destination,{ledgerCode:input.kind === "local_sale" ? "AR" : "AP",debit:input.kind === "raw_purchase" ? value : 0,credit:input.kind === "local_sale" ? value : 0,partyId:party.id}],input.kind === "local_sale" ? "receipt" : "payment",`${p.kind} · ${p.account}${p.note ? " · "+p.note : ""}`);
      }
      if(input.commission) await voucher("commission",[{ledgerCode:"EXP_MISC",debit:rupeesToMinor(input.commission),credit:0},{ledgerCode:"CASH",debit:0,credit:rupeesToMinor(input.commission)}],"payment","Sales commission");
      if(input.collectionCashAdjustment) await voucher("collection-adjustment",[{ledgerCode:"CUSTOMER_COLLECTION_CLEARING",debit:rupeesToMinor(input.collectionCashAdjustment),credit:0},{ledgerCode:"CASH",debit:0,credit:rupeesToMinor(input.collectionCashAdjustment)}],"payment","Same-day non-material collection adjustment");
      await tx.auditEvent.create({data:{factoryId:user.factoryId,actorId:user.id,action:"books.trade_posted",entityType:"trade_document",entityId:document.id,payload:input as Prisma.InputJsonValue}});
      return tx.tradeDocument.findUniqueOrThrow({where:{id:document.id},include:{settlements:true}});
    },{timeout:60000});
  }

  async settle(user: AuthenticatedUser, id: string, raw: unknown) {
    const input = parse(z.object({clientOpId:text,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),payment}).strict(),raw);
    const at = date(input.date);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM factory WHERE id=${user.factoryId} FOR UPDATE`;
      const doc = await tx.tradeDocument.findFirst({where:{id,factoryId:user.factoryId},include:{settlements:true}});
      if(!doc) throw new NotFoundException("Bill not found");
      if(at.toISOString().slice(0,10)<doc.occurredOn.toISOString().slice(0,10)) throw new BadRequestException("Payment precedes bill");
      const old = doc.settlements.find(p => p.clientOpId===input.clientOpId);
      if(old) { if(hash(old.payload)!==hash(input.payment) || old.occurredOn.toISOString().slice(0,10)!==input.date) throw new ConflictException("Payment operation reused"); return old; }
      if(doc.kind === "raw_purchase" && input.payment.kind !== "funds") throw new BadRequestException("Purchase payment requires funds");
      const due = rupeesToMinor(Number(doc.materialAmount)+Number(doc.customerAdjustment)+Number(doc.gstAmount))-doc.settlements.reduce((s,p)=>s+rupeesToMinor(Number(p.amount)),0);
      const amount = rupeesToMinor(input.payment.amount);
      if(amount>due) throw new BadRequestException("Payment exceeds outstanding");
      const party = await ensureParty(tx,user.factoryId,doc.partyName,doc.kind === "local_sale" ? "customer" : "supplier");
      const destination = doc.kind === "local_sale" ? await this.destination(tx,user,input.payment,doc.partyName) : {ledgerCode:await this.ensureFunds(tx,user.factoryId,input.payment.account),debit:0,credit:amount};
      const row = await tx.tradeSettlement.create({data:{documentId:id,clientOpId:input.clientOpId,amount:input.payment.amount,occurredOn:at,payload:input.payment as Prisma.InputJsonValue}});
      await postVoucher(tx,{factoryId:user.factoryId,type:doc.kind === "local_sale"?"receipt":"payment",source:"manual",sourceId:id,partyId:party.id,createdBy:user.id,clientOpId:`trade-payment:${id}:${input.clientOpId}`,operationalDate:at,memo:`${doc.reference} · ${input.payment.account} · ${input.payment.note ?? ""}`,lines:[destination,{ledgerCode:doc.kind === "local_sale" ? "AR":"AP",debit:doc.kind === "raw_purchase"?amount:0,credit:doc.kind === "local_sale"?amount:0,partyId:party.id}]});
      await tx.auditEvent.create({data:{factoryId:user.factoryId,actorId:user.id,action:"books.trade_settlement",entityType:"trade_document",entityId:id,payload:input as Prisma.InputJsonValue}});
      return row;
    },{timeout:30000});
  }
}
