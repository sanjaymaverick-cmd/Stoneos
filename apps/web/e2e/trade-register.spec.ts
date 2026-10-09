import { expect, test } from "@playwright/test";
test.use({serviceWorkers:"block"});
for(const width of [390,1280]) {
  test(`trade register entry and later annotated payment at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.addInitScript(()=>localStorage.setItem("stoneos.token","fixture"));
    let bills:any[]=[];
    await page.route("**/api/v1/**",async route=>{
      const path=new URL(route.request().url()).pathname,method=route.request().method();
      if(path.endsWith("/auth/me"))return route.fulfill({json:{id:"owner",factoryId:"factory",role:"owner",mustChangePassword:false}});
      if(path.endsWith("/trades/accounts"))return route.fulfill({json:[{name:"Jagdish PhonePe",balance:5000}]});
      if(path.endsWith("/books/trades")&&method==="GET")return route.fulfill({json:bills});
      if(path.endsWith("/books/trades")&&method==="POST") {
        const b=route.request().postDataJSON();
        expect(b.materialAmount).toBe(1000);expect(b.gstAmount).toBe(0);
        expect(b.payments[0]).toMatchObject({kind:"vendor_advance",account:"CCTV vendor",amount:200});
        bills=[{...b,id:"bill",partyName:b.partyName,occurredOn:b.date,materialAmount:"1000",customerAdjustment:"0",gstAmount:"0",payload:b,outstanding:800,stockStatus:"pending_lot_allocation",settlements:[]}];
        return route.fulfill({json:bills[0]});
      }
      if(path.endsWith("/bill/payments")) {
        const b=route.request().postDataJSON();expect(b.payment).toMatchObject({kind:"funds",account:"Jagdish PhonePe",amount:800,note:"Received on our behalf"});
        bills[0].outstanding=0;return route.fulfill({json:{id:"payment"}});
      }
      return route.fulfill({json:[]});
    });
    await page.goto("/books/trades");
    await page.getByText("Add a bill",{exact:true}).click();
    await page.getByLabel("Slip / invoice number").fill("S1");await page.getByLabel("Customer",{exact:true}).fill("Buyer");
    await page.getByLabel("Agreed material value ₹").fill("1000");await page.getByLabel("Variety",{exact:true}).fill("R Black");await page.getByLabel("Sqft",{exact:true}).fill("10");await page.getByLabel("Rate ₹",{exact:true}).fill("100");
    await page.getByRole("button",{name:"Add payment",exact:true}).click();
    const form=page.locator("form").first();await form.getByLabel("Settlement type").selectOption("vendor_advance");await form.getByLabel("Account or vendor").fill("CCTV vendor");await form.getByLabel("Amount ₹",{exact:true}).fill("200");
    await page.getByRole("button",{name:"Post bill",exact:true}).click();await expect(page.getByText("Dispatch lot allocation pending",{exact:true})).toBeVisible();
    await page.getByText("Record a later payment",{exact:true}).click();const pay=page.locator("#trade-payment");await pay.getByLabel("Outstanding bill",{exact:true}).selectOption("bill");await pay.getByLabel("Account or vendor").fill("Jagdish PhonePe");await pay.getByLabel("Amount ₹",{exact:true}).fill("800");await pay.getByLabel("Payment note").fill("Received on our behalf");await pay.getByRole("button",{name:"Record payment",exact:true}).click();await expect(page.getByText("Payment recorded.",{exact:true})).toBeVisible();
  });
}
