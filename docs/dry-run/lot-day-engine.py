"""Lot dry run for Vedam / StoneOS. Counts, not per-slab serials.

Run: python3 docs/dry-run/lot-day-engine.py
Writes a markdown report next to this file. Does not call the API.
"""
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

Q = Decimal("0.01")
GST_BLOCK = Decimal("5")
GST_SLAB = Decimal("18")
SQFT = Decimal("49.5")


def M(n):
    return Decimal(str(n)).quantize(Q, rounding=ROUND_HALF_UP)


def inr(n):
    n = M(n)
    sign = "-" if n < 0 else ""
    whole, frac = f"{abs(n):.2f}".split(".")
    if len(whole) <= 3:
        grouped = whole
    else:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while head:
            parts.append(head[-2:])
            head = head[:-2]
        grouped = ",".join(reversed(parts)) + "," + tail
    return f"{sign}₹{grouped}.{frac}"


class Lot:
    def __init__(self, serial, variety, tons, supplier):
        self.serial = serial
        self.variety = variety
        self.tons = Decimal(str(tons))
        self.supplier = supplier
        self.cut = self.damaged = self.good = self.broken = self.sold = 0
        self.bill_tax = self.cash_buy = self.gst_in = Decimal("0")

    @property
    def avail(self):
        return self.good - self.broken - self.sold


def run():
    events, invoices, cash_notes = [], [], []
    customers, suppliers, lots = {}, {}, {}
    cash = input_gst = output_gst = Decimal("0")

    def log(agent, msg):
        events.append((agent, msg))

    def purchase(serial, variety, tons, supplier, bill_tax, cash_amt):
        nonlocal cash, input_gst
        bill_tax, cash_amt = M(bill_tax), M(cash_amt)
        gst = M(bill_tax * GST_BLOCK / 100)
        cgst = M(gst / 2)
        lot = Lot(serial, variety, tons, supplier)
        lot.bill_tax, lot.cash_buy, lot.gst_in = bill_tax, cash_amt, gst
        lots[serial] = lot
        suppliers.setdefault(supplier, {"bill": Decimal("0"), "gst": Decimal("0"), "cash": Decimal("0")})
        suppliers[supplier]["bill"] += bill_tax + gst
        suppliers[supplier]["gst"] += gst
        suppliers[supplier]["cash"] += cash_amt
        cash -= cash_amt
        input_gst += gst
        log("Purchase", f"{serial} {variety} {tons} t from {supplier}. Billing {inr(bill_tax)} + CGST {inr(cgst)} + SGST {inr(gst - cgst)} = {inr(bill_tax + gst)}. Cash without GST {inr(cash_amt)}.")

    def cut(serial, total, damaged):
        lot = lots[serial]
        assert damaged <= total
        lot.cut, lot.damaged, lot.good = total, damaged, total - damaged
        log("Cut", f"{serial}: total slabs cut {total}. Damaged at saw {damaged} not stocked. Good {lot.good} x 49.5 = {M(lot.good * SQFT)} sqft. No per-slab label.")

    def scrap(serial, n, where):
        lot = lots[serial]
        assert n <= lot.avail
        lot.broken += n
        log("Yard", f"Delete {n} from {serial} ({where}). Available {lot.avail}.")

    def sell(serial, customer, qty, rate, bill_share, state, collect_pct):
        nonlocal cash, output_gst
        lot = lots[serial]
        assert qty <= lot.avail, f"{serial} qty {qty} > available {lot.avail}"
        commercial = M(qty * SQFT * Decimal(str(rate)))
        bill_share = M(bill_share)
        assert 0 <= bill_share <= commercial
        cash_leg = M(commercial - bill_share)
        gst = M(bill_share * GST_SLAB / 100)
        if state == "08":
            cgst, sgst, igst = M(gst / 2), M(gst - M(gst / 2)), M(0)
        else:
            cgst = sgst = M(0)
            igst = gst
        invoice_total = bill_share + gst
        lot.sold += qty
        st = customers.setdefault(customer, {"invoiced": Decimal("0"), "collected": Decimal("0"), "cash": Decimal("0"), "lines": []})
        if bill_share > 0:
            no = f"INV-2026-{len(invoices) + 1:04d}"
            invoices.append({"no": no, "total": invoice_total, "taxable": bill_share, "cgst": cgst, "sgst": sgst, "igst": igst})
            st["invoiced"] += invoice_total
            paid = M(invoice_total * Decimal(str(collect_pct)) / 100)
            st["collected"] += paid
            cash += paid
            output_gst += gst
            tax = f"CGST {inr(cgst)} SGST {inr(sgst)}" if state == "08" else f"IGST {inr(igst)}"
            st["lines"].append(f"{no} {serial} x {qty}. Taxable {inr(bill_share)}, {tax}, invoice {inr(invoice_total)}. Collected {inr(paid)}. Cash leg {inr(cash_leg)}.")
            log("Sales", f"{no} {customer} {serial} x {qty}. Commercial {inr(commercial)} = bill {inr(bill_share)} + cash {inr(cash_leg)}. Invoice {inr(invoice_total)}.")
        else:
            no = f"CASH-{len(cash_notes) + 1:03d}"
            cash_notes.append(no)
            st["lines"].append(f"{no} {serial} x {qty}. Cash only {inr(cash_leg)}. No invoice.")
            log("Sales", f"{no} {customer} {serial} x {qty}. Cash only {inr(cash_leg)}. No invoice.")
        st["cash"] += cash_leg
        cash += cash_leg

    purchase("VG-001", "Imperial Red", "22.0", "Chimakurthy Blocks", 220000, 220000)
    purchase("VG-002", "Kashmir White", "20.5", "Kishangarh Rough Supply", 180000, 205000)
    cut("VG-001", 96, 6)
    cut("VG-002", 12, 1)
    scrap("VG-001", 3, "broken in factory transport")
    scrap("VG-002", 1, "edge break while loading")
    sell("VG-001", "Sharma Marbles Jaipur", 40, 85, M(40 * SQFT * 85 / 2), "08", 100)
    sell("VG-001", "Udaipur Stone Studio", 20, 90, M(20 * SQFT * 90), "08", 50)
    sell("VG-002", "Pink City Kitchens", 6, 80, 0, "08", 0)
    sell("VG-001", "Ahmedabad Stone House", 15, 88, M(15 * SQFT * 44), "24", 0)
    oversell = "not rejected"
    try:
        sell("VG-001", "Year Run Buyer", 100, 80, 1000, "08", 0)
    except AssertionError as exc:
        oversell = str(exc)

    good = sum(M(lot.good * SQFT) for lot in lots.values())
    assert good == M("4999.50")
    assert lots["VG-001"].avail == 12
    lines = ["# StoneOS lot dry run — 2 Oct 2026", "", f"Good production {good} sqft. Oversell guard: {oversell}.", f"Cash drawer {inr(cash)}. Input GST {inr(input_gst)}. Output GST {inr(output_gst)}.", ""]
    for agent, msg in events:
        lines.append(f"- **{agent}.** {msg}")
    lines.append("")
    for name, st in customers.items():
        lines.append(f"- **{name}.** Invoiced {inr(st['invoiced'])}, collected {inr(st['collected'])}, outstanding {inr(st['invoiced'] - st['collected'])}, cash leg {inr(st['cash'])}.")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    report = run()
    out = Path(__file__).with_name("2026-10-02-vg001-lot-day.md")
    out.write_text(report, encoding="utf-8")
    print(out)
