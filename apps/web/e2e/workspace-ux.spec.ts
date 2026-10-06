import { test, expect } from "@playwright/test";
test.use({ serviceWorkers: "block" });
for (const width of [360, 390, 1280]) {
 for (const path of ["/dashboard", "/inventory", "/consumables", "/expenses"]) {
  test(`bounded workspace ${path} at ${width}px`, async ({page}) => {
   await page.setViewportSize({width,height:844});
   await page.addInitScript(()=>localStorage.setItem("stoneos.token","fixture"));
   const requests: string[] = [];
   await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()); requests.push(url.pathname+url.search);
    if(url.pathname.endsWith("/auth/me")) return route.fulfill({json:{id:"owner",factoryId:"test",username:"owner",role:"owner",active:true,mustChangePassword:false}});
    if(url.pathname.endsWith("/reports/today"))return route.fulfill({json:{collectedMtd:161850720,outstandingAr:47814780,blocksOnHand:528,slabsOnHand:29040,maintenanceDue:0,expensesMtd:40891300,recoveryRatio:110,recoveryBenchmark:105}});
    if(url.pathname.endsWith("/books/outstanding"))return route.fulfill({json:{youllGet:47814780,youllGive:111253200,net:-63438420,parties:[]}});
    if(url.pathname.endsWith("/books/collections-today"))return route.fulfill({json:{collected:15000000}});
    if(url.searchParams.has("page")) {
     const rows = url.pathname.endsWith("/slabs") ? [{id:"slab",slabSerial:"B21-0001-S01",parentBlockId:"block",parentBlock:{serialNumber:"B21-0001"},salesStatus:"in_stock",lengthFt:"8",widthFt:"5",thicknessMm:18,finish:"glossy",varietyName:"Kotda black"}] : url.pathname.endsWith("/raw-blocks") ? [{id:"block",serialNumber:"B21-0001",varietyName:"Kotda black",currentStatus:"in_stock"}] : url.pathname.endsWith("/expenses") ? [{id:"expense",category:"electricity",amount:"1000",expenseDate:"2026-10-01",allocations:[],taxableAmount:1000}] : url.pathname.endsWith("/movements") ? [] : [{id:"epoxy",name:"Epoxy",unit:"litre",onHand:"2000"}];
     return route.fulfill({json:{items:rows,total:29040,page:Number(url.searchParams.get("page")),pageSize:50}});
    }
    return route.fulfill({json:[]});
   });
   await page.goto(path); await expect(page.locator("main h1")).toBeVisible();
   if(path==="/inventory") {
    await expect(page.getByRole("heading",{name:"Stock by block or finished purchase"})).toBeVisible();
    await expect(page.getByLabel("Serial",{exact:true})).not.toBeVisible();
    await expect.poll(()=>requests.some(r=>r.includes("inventory/slabs?")&&r.includes("pageSize=50"))).toBeTruthy();
    await page.getByRole("button",{name:"Receive raw block",exact:true}).click();
    await expect(page.getByLabel("Serial",{exact:true})).toBeVisible();
   }
   if(path==="/expenses")await expect.poll(()=>requests.some(r=>r.includes("/expenses?page="))).toBeTruthy();
   if(path==="/consumables")await expect.poll(()=>requests.some(r=>r.includes("/consumables?page="))).toBeTruthy();
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
   await page.locator(".more summary").click();
   await expect(page.getByRole("link",{name:"Consumables",exact:true})).toBeVisible();
   await expect(page.getByRole("link",{name:"Recovery & quality",exact:true})).toBeVisible();
  });
 }
}
