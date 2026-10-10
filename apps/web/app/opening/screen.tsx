"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ApiError, api, readToken } from "../../lib/api";
import { formatAmount, formatInr } from "../../lib/labels";
import type { PublicUser } from "../../lib/session";

export interface OpeningBook {
  accounts: { id: string; name: string; kind: string; balance: string }[];
  parties: {
    id: string;
    name: string;
    kind: string;
    bankDue: string;
    cashDue: string;
    royaltyDue: string;
    transportDue: string;
  }[];
  items: { id: string; kind: string; name: string; unit: string }[];
  blocks: {
    id: string;
    itemId: string;
    blockNumber: string;
    variety: string;
    tons: string;
    ratePerTon: string;
    royaltyPerTon: string;
    value: string;
  }[];
  slabs: {
    id: string;
    itemId: string;
    variety: string;
    finish: string;
    sqft: string;
    ratePerSqft: string;
    jobWork: boolean;
    value: string | null;
  }[];
  store: { id: string; itemId: string; name: string; unit: string; quantity: string; rate: string; value: string }[];
  settled: { head: string; label: string; amount: string | null }[];
  totals: {
    money: string;
    customerBank: string;
    customerCash: string;
    advances: string;
    mineBank: string;
    mineStone: string;
    mineRoyalty: string;
    mineTransport: string;
    mineCash: string;
    staff: string;
    blockTons: string;
    blockValue: string;
    slabSqft: string;
    jobSqft: string;
    slabValue: string;
    storeValue: string;
  };
}

const sections = [
  ["money", "Money"],
  ["parties", "Parties"],
  ["items", "Items"],
  ["blocks", "Blocks"],
  ["slabs", "Slabs"],
  ["store", "Store"],
  ["paid", "Paid"],
] as const;

type Section = (typeof sections)[number][0];

export function OpeningScreen({
  user,
  book,
  onBook,
}: {
  user: PublicUser;
  book: OpeningBook;
  onBook: (book: OpeningBook) => void;
}) {
  const [section, setSection] = useState<Section>("money");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function send(path: string, body: unknown | undefined, method?: string): Promise<OpeningBook | null> {
    const token = readToken();
    if (!token) return null;
    setError("");
    setPending(true);
    try {
      const next = await api<OpeningBook>(path, { method, token, body });
      onBook(next);
      return next;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save this line");
      return null;
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="sheet wide">
      <p className="kicker">{user.factoryName}</p>
      <h1>Open the books</h1>
      <p className="lede">The September sheet is the source. Type each line. These figures open the books on 1 October.</p>
      <div className="switcher">
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={section === id}
            onClick={() => {
              setSection(id);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <p className="error">{error}</p> : null}
      <MoneySection hidden={section !== "money"} book={book} pending={pending} send={send} />
      <PartySection hidden={section !== "parties"} book={book} pending={pending} send={send} />
      <ItemSection hidden={section !== "items"} book={book} pending={pending} send={send} />
      <BlockSection hidden={section !== "blocks"} book={book} pending={pending} send={send} />
      <SlabSection hidden={section !== "slabs"} book={book} pending={pending} send={send} />
      <StoreSection hidden={section !== "store"} book={book} pending={pending} send={send} />
      <PaidSection hidden={section !== "paid"} book={book} pending={pending} send={send} />
      <div className="actions"><Link className="button quiet" href="/">Back</Link></div>
    </main>
  );
}

function MoneySection({
  hidden,
  book,
  pending,
  send,
}: SectionProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("CASH");
  const [balance, setBalance] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await send("/api/v1/opening/accounts", { name, kind, balance });
    if (saved) {
      setName("");
      setBalance("");
    }
  }

  return (
    <section className="card" hidden={hidden}>
      <h2>Money</h2>
      <p className="lede">Name each cash box, bank, and UPI. Zero is allowed.</p>
      <p className="totals">On hand {formatInr(book.totals.money)}</p>
      <form onSubmit={(event) => void submit(event)}>
        <div className="choices">
          <Choice pressed={kind === "CASH"} onClick={() => setKind("CASH")}>Cash</Choice>
          <Choice pressed={kind === "BANK"} onClick={() => setKind("BANK")}>Bank</Choice>
          <Choice pressed={kind === "UPI"} onClick={() => setKind("UPI")}>UPI</Choice>
        </div>
        <Field label="Name" value={name} onChange={setName} />
        <Field label="Opening balance" value={balance} onChange={setBalance} numeric />
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Add account"}</button>
        </div>
      </form>
      <ul className="people">
        {book.accounts.map((account) => (
          <li key={account.id}>
            <p>
              <strong>{account.name}</strong><br />
              <span className="tag">{accountLabel(account.kind)} · {formatInr(account.balance)}</span>
            </p>
            <Remove pending={pending} onClick={() => void send(`/api/v1/opening/accounts/${account.id}`, undefined, "DELETE")} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PartySection({ hidden, book, pending, send }: SectionProps) {
  const [kind, setKind] = useState("CUSTOMER");
  const [name, setName] = useState("");
  const [bankDue, setBankDue] = useState("");
  const [cashDue, setCashDue] = useState("");
  const [royaltyDue, setRoyaltyDue] = useState("");
  const [transportDue, setTransportDue] = useState("");
  const totals = book.totals;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await send("/api/v1/opening/parties", {
      name,
      kind,
      bankDue: kind === "STAFF" || kind === "ADVANCE" ? "" : bankDue,
      cashDue,
      royaltyDue: kind === "MINE" ? royaltyDue : "",
      transportDue: kind === "MINE" ? transportDue : "",
    });
    if (saved) {
      setName("");
      setBankDue("");
      setCashDue("");
      setRoyaltyDue("");
      setTransportDue("");
    }
  }

  return (
    <section className="card" hidden={hidden}>
      <h2>Parties</h2>
      <p className="lede">Customers, mines, staff, and advances as at 30 September.</p>
      <p className="totals">
        Customers bank {formatInr(totals.customerBank)}, cash {formatInr(totals.customerCash)}.
        Advances paid out {formatInr(totals.advances)}.
        Mines bank {formatInr(totals.mineBank)}, cash {formatInr(totals.mineCash)}
        {" "}(stone {formatInr(totals.mineStone)}, royalty {formatInr(totals.mineRoyalty)}, transport {formatInr(totals.mineTransport)}).
        Staff and others {formatInr(totals.staff)}.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <div className="choices">
          <Choice pressed={kind === "CUSTOMER"} onClick={() => setKind("CUSTOMER")}>Customer</Choice>
          <Choice pressed={kind === "MINE"} onClick={() => setKind("MINE")}>Mine</Choice>
          <Choice pressed={kind === "STAFF"} onClick={() => setKind("STAFF")}>Staff</Choice>
          <Choice pressed={kind === "ADVANCE"} onClick={() => setKind("ADVANCE")}>Advance</Choice>
        </div>
        <Field label="Name" value={name} onChange={setName} />
        {kind === "CUSTOMER" ? (
          <>
            <p className="lede">If the sheet has one figure, put it in bank due and leave cash at 0.</p>
            <Field label="Bank due" value={bankDue} onChange={setBankDue} numeric />
            <Field label="Cash due" value={cashDue} onChange={setCashDue} numeric />
          </>
        ) : null}
        {kind === "MINE" ? (
          <>
            <p className="lede">Bank due is the GST invoice. Unbilled stone, royalty, and transport stay on the cash side.</p>
            <Field label="Bank due" value={bankDue} onChange={setBankDue} numeric />
            <Field label="Unbilled stone" value={cashDue} onChange={setCashDue} numeric />
            <Field label="Royalty" value={royaltyDue} onChange={setRoyaltyDue} numeric />
            <Field label="Transport" value={transportDue} onChange={setTransportDue} numeric />
          </>
        ) : null}
        {kind === "STAFF" ? <Field label="Amount owed" value={cashDue} onChange={setCashDue} numeric /> : null}
        {kind === "ADVANCE" ? (
          <>
            <p className="lede">Money already paid out. This is not a customer due.</p>
            <Field label="Amount already paid" value={cashDue} onChange={setCashDue} numeric />
          </>
        ) : null}
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Add party"}</button>
        </div>
      </form>
      <ul className="people">
        {book.parties.map((party) => (
          <li key={party.id}>
            <p>
              <strong>{party.name}</strong><br />
              <span className="tag">{partyDetail(party)}</span>
            </p>
            <Remove pending={pending} onClick={() => void send(`/api/v1/opening/parties/${party.id}`, undefined, "DELETE")} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemSection({ hidden, book, pending, send }: SectionProps) {
  const [kind, setKind] = useState("VARIETY");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await send("/api/v1/opening/items", {
      kind,
      name,
      unit: kind === "CONSUMABLE" ? unit : "",
    });
    if (saved) {
      setName("");
      setUnit("");
    }
  }

  return (
    <section className="card" hidden={hidden}>
      <h2>Items</h2>
      <p className="lede">Create a variety or a consumable first. Then add it to stock. Each consumable on the stock statement is already an item.</p>
      <form onSubmit={(event) => void submit(event)}>
        <div className="choices">
          <Choice pressed={kind === "VARIETY"} onClick={() => setKind("VARIETY")}>Variety</Choice>
          <Choice pressed={kind === "CONSUMABLE"} onClick={() => setKind("CONSUMABLE")}>Consumable</Choice>
        </div>
        <Field label="Name" value={name} onChange={setName} />
        {kind === "CONSUMABLE" ? <Field label="Unit" value={unit} onChange={setUnit} /> : null}
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Create item"}</button>
        </div>
      </form>
      <ul className="people">
        {book.items.map((item) => (
          <li key={item.id}>
            <p>
              <strong>{item.name}</strong><br />
              <span className="tag">
                {item.kind === "CONSUMABLE" ? `Consumable · ${item.unit}` : "Variety"}
                {itemInStock(item.id, book) ? "" : " · Not in stock yet"}
              </span>
            </p>
            {itemInStock(item.id, book) ? null : (
              <Remove pending={pending} onClick={() => void send(`/api/v1/opening/items/${item.id}`, undefined, "DELETE")} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BlockSection({ hidden, book, pending, send }: SectionProps) {
  const [itemId, setItemId] = useState("");
  const [blockNumber, setBlockNumber] = useState("");
  const [tons, setTons] = useState("");
  const [ratePerTon, setRatePerTon] = useState("");
  const [royaltyPerTon, setRoyaltyPerTon] = useState("");
  const varieties = book.items.filter((item) => item.kind === "VARIETY");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await send("/api/v1/opening/blocks", { itemId, blockNumber, tons, ratePerTon, royaltyPerTon });
    if (saved) {
      setBlockNumber("");
      setTons("");
      setRatePerTon("");
      setRoyaltyPerTon("");
    }
  }

  return (
    <section className="card" hidden={hidden}>
      <h2>Blocks</h2>
      <p className="lede">Uncut blocks on 30 September. A line can group numbers, such as 656-658. Create a new variety in Items, then add it to stock.</p>
      <p className="totals">{formatAmount(book.totals.blockTons, 3)} tons. Stone {formatInr(book.totals.blockValue)}.</p>
      <form onSubmit={(event) => void submit(event)}>
        <Select label="Variety" value={itemId} onChange={setItemId} options={varieties} empty="Create the item first" />
        <Field label="Block number" value={blockNumber} onChange={setBlockNumber} />
        <Field label="Tons" value={tons} onChange={setTons} numeric />
        <Field label="Rate per ton" value={ratePerTon} onChange={setRatePerTon} numeric />
        <Field label="Royalty per ton" value={royaltyPerTon} onChange={setRoyaltyPerTon} numeric placeholder="336" />
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Add to stock"}</button>
        </div>
      </form>
      <ul className="people">
        {book.blocks.map((block) => (
          <li key={block.id}>
            <p>
              <strong>{block.blockNumber}</strong><br />
              <span className="tag">
                {block.variety} · {formatAmount(block.tons, 3)} tons · {formatInr(block.ratePerTon)} a ton · royalty {formatInr(block.royaltyPerTon)} · stone {formatInr(block.value)}
              </span>
            </p>
            <Remove pending={pending} onClick={() => void send(`/api/v1/opening/blocks/${block.id}`, undefined, "DELETE")} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SlabSection({ hidden, book, pending, send }: SectionProps) {
  const [itemId, setItemId] = useState("");
  const [finish, setFinish] = useState("Polish");
  const [sqft, setSqft] = useState("");
  const [ratePerSqft, setRatePerSqft] = useState("");
  const [jobWork, setJobWork] = useState(false);
  const varieties = book.items.filter((item) => item.kind === "VARIETY");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await send("/api/v1/opening/slabs", { itemId, finish, sqft, ratePerSqft, jobWork });
    if (saved) {
      setSqft("");
      setRatePerSqft("");
      setJobWork(false);
    }
  }

  return (
    <section className="card" hidden={hidden}>
      <h2>Slabs</h2>
      <p className="lede">Slabs already in the yard on 30 September, by variety and finish. Job-work sqft counts in the quantity and is not Vedam&apos;s stone. Create a new variety in Items, then add it to stock.</p>
      <p className="totals">
        {formatAmount(book.totals.slabSqft)} sqft, including {formatAmount(book.totals.jobSqft)} sqft of job work.
        Vedam&apos;s stone {formatInr(book.totals.slabValue)}.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <Select label="Variety" value={itemId} onChange={setItemId} options={varieties} empty="Create the item first" />
        <div className="choices">
          {["Polish", "Lapotra", "Rough", "Honed", "Leather"].map((item) => (
            <Choice key={item} pressed={finish === item} onClick={() => setFinish(item)}>{item}</Choice>
          ))}
        </div>
        <Field label="Sqft" value={sqft} onChange={setSqft} numeric />
        <Field label="Rate per sqft" value={ratePerSqft} onChange={setRatePerSqft} numeric />
        <label className="check">
          <input type="checkbox" checked={jobWork} onChange={(event) => setJobWork(event.target.checked)} />
          Job work. Count the sqft. Leave it out of Vedam&apos;s stone value.
        </label>
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Add to stock"}</button>
        </div>
      </form>
      <ul className="people">
        {book.slabs.map((slab) => (
          <li key={slab.id}>
            <p>
              <strong>{slab.variety}</strong><br />
              <span className="tag">
                {slab.finish}{slab.jobWork ? " · Job work" : ""} · {formatAmount(slab.sqft)} sqft
                {slab.value ? ` · ${formatInr(slab.ratePerSqft)} a sqft · ${formatInr(slab.value)}` : " · counted, not Vedam's stone"}
              </span>
            </p>
            <Remove pending={pending} onClick={() => void send(`/api/v1/opening/slabs/${slab.id}`, undefined, "DELETE")} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function StoreSection({ hidden, book, pending, send }: SectionProps) {
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  const consumables = book.items.filter((item) => item.kind === "CONSUMABLE");
  const chosen = consumables.find((item) => item.id === itemId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await send("/api/v1/opening/store", { itemId, quantity, rate });
    if (saved) {
      setQuantity("");
      setRate("");
    }
  }

  return (
    <section className="card" hidden={hidden}>
      <h2>Store</h2>
      <p className="lede">Each consumable is an item. Create it in Items, then add the quantity to stock. The amount is quantity times rate.</p>
      <p className="totals">Store {formatInr(book.totals.storeValue)}</p>
      <form onSubmit={(event) => void submit(event)}>
        <Select label="Item" value={itemId} onChange={setItemId} options={consumables} empty="Create the item first" />
        {chosen ? <p className="lede">Unit {chosen.unit}</p> : null}
        <Field label="Quantity" value={quantity} onChange={setQuantity} numeric />
        <Field label="Rate" value={rate} onChange={setRate} numeric />
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Add to stock"}</button>
        </div>
      </form>
      <ul className="people">
        {book.store.map((item) => (
          <li key={item.id}>
            <p>
              <strong>{item.name}</strong><br />
              <span className="tag">{formatAmount(item.quantity, 3)} {item.unit} · {formatInr(item.rate)} · {formatInr(item.value)}</span>
            </p>
            <Remove pending={pending} onClick={() => void send(`/api/v1/opening/store/${item.id}`, undefined, "DELETE")} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PaidSection({ hidden, book, pending, send }: SectionProps) {
  const [amounts, setAmounts] = useState<Record<string, string>>(() => settledState(book));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = await send("/api/v1/opening/settled", { amounts }, "PUT");
    if (next) setAmounts(settledState(next));
  }

  return (
    <section className="card" hidden={hidden}>
      <h2>Already paid</h2>
      <p className="lede">These amounts are already settled. A blank box leaves the saved figure. Type 0 to record zero.</p>
      <form onSubmit={(event) => void submit(event)}>
        {book.settled.map((row) => (
          <Field
            key={row.head}
            label={row.label}
            value={amounts[row.head] ?? ""}
            onChange={(value) => setAmounts((current) => ({ ...current, [row.head]: value }))}
            numeric
          />
        ))}
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </section>
  );
}

function settledState(book: OpeningBook): Record<string, string> {
  const amounts: Record<string, string> = {};
  for (const row of book.settled) amounts[row.head] = row.amount ?? "";
  return amounts;
}

function partyDetail(party: OpeningBook["parties"][number]): string {
  if (party.kind === "CUSTOMER") return `Customer · bank ${formatInr(party.bankDue)} · cash ${formatInr(party.cashDue)}`;
  if (party.kind === "MINE") {
    return `Mine · bank ${formatInr(party.bankDue)} · stone ${formatInr(party.cashDue)} · royalty ${formatInr(party.royaltyDue)} · transport ${formatInr(party.transportDue)}`;
  }
  if (party.kind === "STAFF") return `Staff · owed ${formatInr(party.cashDue)}`;
  return `Advance · paid out ${formatInr(party.cashDue)}`;
}

function accountLabel(kind: string): string {
  if (kind === "CASH") return "Cash";
  if (kind === "BANK") return "Bank";
  return "UPI";
}

type SectionProps = {
  hidden: boolean;
  book: OpeningBook;
  pending: boolean;
  send: (path: string, body: unknown | undefined, method?: string) => Promise<OpeningBook | null>;
};

function Field({
  label,
  value,
  onChange,
  numeric,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input
        value={value}
        placeholder={placeholder}
        inputMode={numeric ? "decimal" : "text"}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function itemInStock(itemId: string, book: OpeningBook): boolean {
  return book.blocks.some((row) => row.itemId === itemId)
    || book.slabs.some((row) => row.itemId === itemId)
    || book.store.some((row) => row.itemId === itemId);
}

function Select({
  label,
  value,
  onChange,
  options,
  empty,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  empty: string;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{empty}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
    </label>
  );
}

function Choice({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button type="button" className="choice" aria-pressed={pressed} onClick={onClick}>{children}</button>
  );
}

function Remove({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return <button type="button" className="quiet" disabled={pending} onClick={onClick}>Remove</button>;
}
