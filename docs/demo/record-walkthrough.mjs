import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const W = 1600, H = 900;
const browser = await chromium.launch({ args: ["--force-device-scale-factor=1"] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: "/tmp/promo/raw", size: { width: W, height: H } },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

/* A caption bar, injected into the page so it is burned into the recording. */
async function caption(title, sub = "", hold = 2600) {
  await page.evaluate(([t, s]) => {
    let el = document.getElementById("__promo");
    if (!el) {
      el = document.createElement("div");
      el.id = "__promo";
      el.style.cssText = `position:fixed;left:0;right:0;bottom:0;z-index:2147483647;
        background:linear-gradient(to top,rgba(20,16,14,.96),rgba(20,16,14,.86));
        color:#fff;padding:22px 40px 26px;font:400 25px/1.35 Georgia,serif;
        border-top:3px solid #9c3b2e;transition:opacity .35s;opacity:0;`;
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="font-weight:600;letter-spacing:.2px">${t}</div>` +
      (s ? `<div style="opacity:.78;font-size:19px;margin-top:5px">${s}</div>` : "");
    el.style.opacity = "1";
  }, [title, sub]);
  await page.waitForTimeout(hold);
}
async function clearCaption() {
  await page.evaluate(() => {
    const el = document.getElementById("__promo");
    if (el) el.style.opacity = "0";
  }).catch(() => {});
  await page.waitForTimeout(400);
}
/* Scroll slowly so the recording reads rather than jumps. */
async function glide(to, steps = 26) {
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), (to * i) / steps);
    await page.waitForTimeout(42);
  }
}
const type = (sel, v) => page.locator(sel).pressSequentially(v, { delay: 70 });

// ---------- title ----------
await page.goto("http://localhost:3000/login");
await page.waitForTimeout(900);
await page.evaluate(() => {
  const s = document.createElement("div");
  s.id = "__title";
  s.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:#141010;color:#f5efe6;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font:400 20px/1.5 Georgia,serif;transition:opacity .8s;isolation:isolate`;
  document.documentElement.appendChild(s);
  s.innerHTML = `<div style="font-size:82px;letter-spacing:-1px">Vedam <span style="opacity:.55">≡</span></div>
    <div style="font-size:31px;margin-top:14px;opacity:.9">StoneOS</div>
    <div style="margin-top:30px;opacity:.6;font-size:21px">Granite factory operations, from the block to the GST return</div>
    <div style="margin-top:52px;opacity:.38;font-size:16px">Demonstration data — one full financial year</div>\n    <div style="margin-top:10px;opacity:.38;font-size:16px">₹4.05 crore turnover · 12.8 lakh sq ft · 411 blocks · 355 invoices</div>`;
});
await page.waitForTimeout(4200);
await page.evaluate(() => { const s = document.getElementById("__title"); if (s) s.style.opacity = "0"; });
await page.waitForTimeout(900);
await page.evaluate(() => document.getElementById("__title")?.remove());

// ---------- sign in ----------
await caption("One login for the whole yard", "Roles decide what each person can reach", 2400);
await type('input[autocomplete="username"]', "owner");
await type('input[type="password"]', "ChangeMeNow!12");
await clearCaption();
await page.click('button[type="submit"]');
await page.waitForTimeout(3200);

// ---------- the yard, by the lot ----------
await page.goto("http://localhost:3000/lots");
await page.waitForTimeout(2600);
await caption("Stock is counted by the lot, not the slab",
  "VG-001-70 — block VG-001, seventy slabs on it. 411 blocks a year; nobody stencils a number on every piece.", 4600);
await clearCaption();
await glide(360);
await caption("Cut, polished, broken, sold — and what is left",
  "Available is what was cut, less what broke, less what sold. Derived, never stored.", 4200);
await clearCaption();
await glide(900);
await caption("Breakage is written off at what it cost",
  "Against a name, with a reason, posted to the ledger. Stock leaving without a sale is the shape of theft as well as of accidents.", 4600);
await clearCaption();

// ---------- selling ----------
await page.goto("http://localhost:3000/lots/sell");
await page.waitForTimeout(2600);
await caption("Sell by the lot", "A lakh of square feet a month, billed together on one invoice", 3800);
await clearCaption();
await glide(500);
await caption("Billed and cash, both recorded",
  "The cash leg posts to its own ledger and the GST return reports it separately as excluded. Nothing is hidden from the owner.", 5000);
await clearCaption();

// ---------- the money ----------
await page.goto("http://localhost:3000/books/reports");
await page.waitForTimeout(3000);
await caption("Statements in the shape of the khata it replaces",
  "Opening balance, every entry, the running balance, Dr and Cr", 4200);
await clearCaption();
await glide(420);
await caption("Who owes us, and who we owe",
  "Two lists, because chasing money and scheduling payments are different jobs", 4200);
await clearCaption();
await glide(1000);
await page.waitForTimeout(1400);

// ---------- GST ----------
await page.goto("http://localhost:3000/books/gst");
await page.waitForTimeout(2800);
await glide(1500, 30);
await caption("GSTR-1, straight off the documents",
  "CGST and SGST within Rajasthan, IGST when the stone leaves it — decided by the buyer's GSTIN", 4600);
await clearCaption();
await page.waitForTimeout(1200);

// ---------- today ----------
await page.goto("http://localhost:3000/dashboard");
await page.waitForTimeout(2800);
await caption("And the whole position on one screen",
  "Stock on the yard, what is owed, what is overdue — the demonstration year closes in March 2026", 4000);
await clearCaption();
await glide(500);
await page.waitForTimeout(1500);

// ---------- close ----------
await page.evaluate(() => {
  const s = document.createElement("div");
  s.style.cssText = `position:fixed;inset:0;z-index:2147483646;background:#141010;color:#f5efe6;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font:400 20px/1.6 Georgia,serif;opacity:0;transition:opacity .8s`;
  s.innerHTML = `<div style="font-size:60px">Vedam <span style="opacity:.55">≡</span> StoneOS</div>
    <div style="margin-top:26px;opacity:.72;font-size:23px">Built for one granite factory, at RIICO Baggad</div>
    <div style="margin-top:38px;opacity:.5;font-size:17px">Works offline on the floor · Double-entry books · GST-ready</div>\n    <div style="margin-top:26px;opacity:.42;font-size:16px">One year, demonstration data: ₹4.05 cr turnover · 12.8 lakh sq ft · books balanced to the rupee</div>`;
  document.body.appendChild(s);
  requestAnimationFrame(() => { s.style.opacity = "1"; });
});
await page.waitForTimeout(4200);

await ctx.close();
await browser.close();
console.log("recorded");
