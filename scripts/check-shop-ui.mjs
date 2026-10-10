// Run against scripts/preview-postgres-ui.mjs + Vite only. All records are fake.
// Playwright can come from a local install or the desktop's bundled dependencies.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
if(process.env.ALLOW_SHOP_UI_FIXTURE!=='1')throw new Error('Set ALLOW_SHOP_UI_FIXTURE=1 for the isolated UI fixture only.');
const require=createRequire(process.env.SHOP_BROWSER_PACKAGE_JSON || new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const base='http://localhost:5173';
const output=resolve('node_modules/.tmp/shop-ui');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844}});
const page=await context.newPage();const staff=await context.newPage();
const errors=[];for(const p of [page,staff])p.on('pageerror',error=>errors.push(error.message));
const screenshot=(p,name)=>p.screenshot({path:resolve(output,name+'.png'),fullPage:true});
const noOverflow=async p=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
async function request(path,data) {
  const response=await context.request.fetch(base+path,{method:data?'POST':'GET',headers:{Origin:base},...(data?{data}:{})});
  const json=await response.json();assert.equal(response.ok(),true,json.error?.message);return json.data;
}
async function openOrder(name) {
  await staff.goto(base+'/staff');await staff.getByRole('button',{name:/Shop Orders/}).click();
  await staff.getByRole('button',{name:new RegExp(name)}).click();await staff.getByRole('dialog').waitFor();
}
async function checkout(name,delivery=false,isTest=false) {
  await page.goto(base+'/products/demo-wrap-dress');await page.getByRole('button',{name:'Add to bag'}).click();
  await page.getByRole('link',{name:'View your bag'}).click();await page.reload();
  await page.getByRole('link',{name:'Continue to checkout'}).waitFor();
  await page.goto(base+'/checkout'+(isTest?'?test=1':''));
  await page.getByLabel('Full name',{exact:true}).fill(name);await page.getByLabel('Ghanaian phone number').fill('0241234590');
  if(delivery){await page.getByLabel('Receive your order').selectOption('delivery');await page.getByLabel('Ghana delivery address').fill('UI fixture, Test Street, Accra, Ghana');}
  else await page.getByLabel('Payment method',{exact:true}).selectOption('cash');
  await screenshot(page,delivery?'mobile-delivery-checkout':'mobile-pickup-checkout');await noOverflow(page);
  await page.getByRole('button',{name:'Place order'}).click();await page.waitForURL(/\/order#[A-Za-z0-9_-]{43}$/);
  await page.getByRole('heading',{name:'Awaiting confirmation',exact:true}).waitFor();return page.url();
}
try {
  await page.goto(base);await page.getByRole('heading',{name:/Made for the way/}).waitFor();await page.getByRole('link',{name:/Demo wrap dress/}).waitFor();await screenshot(page,'mobile-catalogue');await noOverflow(page);
  await staff.goto(base+'/staff');await staff.getByLabel('Email',{exact:true}).fill('demo@atelier.test');await staff.getByLabel('Password',{exact:true}).fill('Demo-workshop-password-123!');await staff.getByRole('button',{name:'Sign in',exact:true}).click();await staff.getByRole('heading',{name:'Workshop dashboard'}).waitFor();
  await staff.evaluate(()=>scrollTo(0,document.body.scrollHeight));
  const nav=await staff.getByRole('navigation',{name:'Primary navigation'}).evaluate(el=>({position:getComputedStyle(el).position,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,height:innerHeight}));
  assert.equal(nav.position,'fixed');assert.ok(nav.top>nav.height-100 && nav.bottom<nav.height);
  await staff.getByRole('button',{name:'Settings',exact:true}).click();await staff.getByRole('button',{name:'Ready-to-wear Shop',exact:true}).click();await staff.getByRole('heading',{name:'Shop details and launch'}).waitFor();await noOverflow(staff);
  assert.equal(await staff.getByLabel('Enable customer checkout').isChecked(),false);
  const testLink=await checkout('UI Test Customer',false,true);
  await openOrder('UI Test Customer');await staff.getByRole('button',{name:'Confirm order',exact:true}).click();await staff.getByRole('button',{name:'Mark ready for pickup'}).click();
  await staff.getByLabel('Amount (GHS)',{exact:true}).fill('250');await staff.getByRole('button',{name:'Save ledger entry',exact:true}).click();
  await staff.getByRole('button',{name:'Confirm collected',exact:true}).click();await staff.getByText('UI Test Customer · Fulfilled · TEST',{exact:true}).waitFor();
  await staff.getByRole('button',{name:'Close modal'}).click();await staff.getByRole('button',{name:'Settings',exact:true}).click();await staff.getByRole('button',{name:'Ready-to-wear Shop',exact:true}).click();
  await staff.getByText('Test order completed: Yes.',{exact:false}).waitFor();await staff.getByLabel('Enable customer checkout').check();await staff.getByRole('button',{name:'Save shop settings',exact:true}).click();await staff.getByText('Shop settings saved.',{exact:true}).waitFor();
  await page.goto(testLink);await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.getByRole('heading',{name:'Fulfilled',exact:true}).waitFor();
  const deliveryLink=await checkout('UI Delivery Customer',true);
  await openOrder('UI Delivery Customer');await staff.getByLabel('Agreed delivery fee (GHS)',{exact:true}).fill('25');await staff.getByLabel('I have agreed this fee with the customer.').check();await staff.getByRole('button',{name:'Confirm order',exact:true}).click();
  await staff.getByLabel('Amount (GHS)',{exact:true}).fill('275');await staff.getByLabel('Transaction reference',{exact:true}).fill('FAKE-UI-MOMO');await staff.getByRole('button',{name:'Save ledger entry',exact:true}).click();await staff.getByRole('button',{name:'Mark ready (requires full payment)'}).click();await staff.getByRole('button',{name:'Confirm dispatched',exact:true}).click();await staff.getByText('UI Delivery Customer · Fulfilled',{exact:true}).waitFor();
  await screenshot(staff,'mobile-order-ledger');await page.goto(deliveryLink);await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.getByRole('heading',{name:'Fulfilled',exact:true}).waitFor();await noOverflow(page);await screenshot(page,'mobile-order-status');
  await staff.getByRole('button',{name:'Close modal'}).click();await staff.getByRole('button',{name:'Settings',exact:true}).click();await staff.getByRole('button',{name:'Ready-to-wear Shop',exact:true}).click();await staff.getByRole('button',{name:'New product',exact:true}).click();
  for(const [label,value] of [['Title','UI browser test piece'],['URL name','ui-browser-test-piece'],['Category','UI tests'],['Price (GHS)','125'],['Description','A fake browser test garment.'],['Size guide','M: bust 36 inches'],['SKU','UI-TEST-M'],['Size','M'],['Colour','Cream'],['On hand','3']])await staff.getByLabel(label,{exact:true}).fill(value);
  await staff.getByRole('button',{name:'Save product',exact:true}).click();await staff.getByText('Product saved.',{exact:true}).waitFor();
  await staff.getByLabel('Photo description',{exact:true}).fill('Fake UI garment test image');
  await staff.getByLabel('Upload product photo',{exact:true}).setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=','base64')});await staff.getByText('Photo uploaded.',{exact:true}).waitFor();
  await staff.getByLabel('Publish in the collection').check();await staff.getByRole('button',{name:'Save product',exact:true}).click();await staff.getByText('Product saved.',{exact:true}).waitFor();await screenshot(staff,'mobile-product-admin');await noOverflow(staff);
  await page.goto(base+'/products/demo-wrap-dress');await page.getByRole('button',{name:'Add to bag'}).click();
  const p=(await request('/api/shop/admin/products')).find(p=>p.slug==='demo-wrap-dress');await request('/api/shop/admin/products',{...p,price_pesewas:27500});
  await page.goto(base+'/cart');await page.getByRole('button',{name:'Accept new price',exact:true}).waitFor();await page.getByRole('button',{name:'Accept new price',exact:true}).click();await page.getByRole('link',{name:'Continue to checkout'}).click();await page.getByRole('heading',{name:'Checkout',exact:true}).waitFor();
  for(const width of [320,768,1280]) {await page.setViewportSize({width,height:900});await page.goto(base);await page.getByRole('link',{name:/UI browser test piece/}).waitFor();await noOverflow(page);await screenshot(page,'catalogue-'+width);}
  assert.deepEqual(errors,[],'no browser runtime errors');console.log('PASS: mobile catalogue, cart recovery, disabled checkout, admin launch, pickup cash, delivery/MoMo, fulfilment, product editor, photos, changed-price review, private links and 320/390/768/1280 layouts.');console.log('Screenshots: '+output);
}catch(error){await screenshot(page,'failed-public-page');await screenshot(staff,'failed-staff-page');throw error;}
finally{await browser.close();}
