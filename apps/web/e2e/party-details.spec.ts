import {test,expect} from "@playwright/test";
test.use({serviceWorkers:"block"});
test("add and edit complete supplier details, and switch to buyers",async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>localStorage.setItem("stoneos.token","fixture"));
 let suppliers:any[]=[];let saved:any;
 await page.route("**/api/v1/**",async route=>{
  const path=new URL(route.request().url()).pathname;const method=route.request().method();
  if(path.endsWith("/auth/me"))return route.fulfill({json:{id:"u",username:"owner",role:"owner",factoryId:"f",active:true,mustChangePassword:false}});
  if(path==="/api/v1/customers")return route.fulfill({json:[{id:"b",name:"Buyer",billingAddress:"Buyer street",gstin:"08ZZZZZ0000Z1ZX"}]});
  if(path.startsWith("/api/v1/inventory/suppliers")){
   if(method==="POST"){saved=route.request().postDataJSON();suppliers=[{id:"s",...saved}];return route.fulfill({json:suppliers[0]});}
   if(method==="PATCH"){saved=route.request().postDataJSON();suppliers=[{id:"s",...saved}];return route.fulfill({json:suppliers[0]});}
   return route.fulfill({json:suppliers});
  }
  return route.fulfill({json:[]});
 });
 await page.goto("/parties");await expect(page.getByRole("heading",{name:"Buyers & suppliers"})).toBeVisible();
 await page.getByLabel("Party type").selectOption("supplier");
 await page.getByLabel("Name",{exact:true}).fill("Quarry");await page.getByLabel("GSTIN",{exact:true}).fill("08ZZZZZ0000Z1ZX");
 await page.getByLabel("Billing address",{exact:true}).fill("Jaipur street");await page.getByLabel("Pickup / dispatch address, if different").fill("Gate 2");await page.getByLabel("Phone",{exact:true}).fill("9876543210");
 await page.getByRole("button",{name:"Add supplier",exact:true}).click();
 await expect(page.getByRole("button",{name:"Edit Quarry"})).toBeVisible();expect(saved.stateCode).toBe("08");expect(saved.shippingAddress).toBe("Gate 2");
 await page.getByRole("button",{name:"Edit Quarry"}).click();await expect(page.getByLabel("Billing address",{exact:true})).toHaveValue("Jaipur street");
 await page.getByLabel("Billing address",{exact:true}).fill("Updated street");await page.getByRole("button",{name:"Save changes"}).click();await expect(page.getByText("Billing address: Updated street",{exact:true})).toBeVisible();
 await page.getByLabel("Party type").selectOption("customer");await expect(page.getByRole("heading",{name:"Add a buyer"})).toBeVisible();
 await page.getByRole("button",{name:"Edit Buyer"}).click();await expect(page.getByLabel("Billing address",{exact:true})).toHaveValue("Buyer street");
 await page.screenshot({path:info.outputPath("party-details.png"),fullPage:true});
});
