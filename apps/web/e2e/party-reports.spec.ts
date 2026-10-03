import { test, expect } from "@playwright/test";
test.use({ serviceWorkers: "block" });
for (const width of [390,1280]) test('multi-year report and matching download at '+width, async ({page}, info)=>{
 await page.setViewportSize({width,height:900});
 await page.addInitScript(()=>localStorage.setItem('stoneos.token','fixture'));
 let query='';let downloadQuery='';
 await page.route('**/api/v1/**',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname.endsWith('/auth/me'))return route.fulfill({json:{id:'u',username:'owner',role:'owner',factoryId:'f',active:true,mustChangePassword:false}});
 if(u.pathname.endsWith('/parties.xlsx')){downloadQuery=u.search;return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:Buffer.from('PKfixture')});}
 if(u.pathname.endsWith('/parties')){query=u.search;return route.fulfill({json:{from:u.searchParams.get('from')||'',to:u.searchParams.get('to'),parties:[{id:'customer:c',name:'Buyer',side:'customer',contact:'',gstin:''}],summary:[{id:'customer:c',name:'Buyer',side:'customer',contact:'',gstin:'',opening:1000,charges:0,credits:250,received:250,paid:0,balance:750,due:750,advance:0}],rows:[{id:'p',date:'2023-04-01',name:'Buyer',type:'Payment received',reference:'INV-1',details:'Collection',debit:0,credit:250,paidIn:250,paidOut:0,mode:'UPI',balance:750}],totals:{received:250,paid:0},note:'Historical payment modes may be Not recorded.'}});}
 return route.fulfill({json:[]});
 });
 await page.goto('/sales/reports');
 await expect(page.getByRole('heading',{name:'Sales & purchase reports'})).toBeVisible();
 await page.getByLabel('Start date',{exact:true}).fill('2020-01-01');
 await page.getByLabel('End date / dues as of').fill('2026-10-03');
 await page.getByRole('button',{name:'Generate report'}).click();
 await expect(page.getByText('Period: 2020-01-01 to 2026-10-03',{exact:false})).toBeVisible();
 expect(new URLSearchParams(query).get('from')).toBe('2020-01-01');
 await expect(page.getByRole('cell',{name:'UPI',exact:true})).toBeVisible();
 await page.getByLabel('Start date',{exact:true}).fill('2025-01-01');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download Excel'}).click();
 expect((await pending).suggestedFilename()).toBe('stoneos-party-report-2026-10-03.xlsx');
 expect(downloadQuery).toBe(query);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('reports.png'),fullPage:true});
});
