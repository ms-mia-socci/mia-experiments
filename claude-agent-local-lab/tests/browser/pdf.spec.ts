import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
test('approved PDF is rendered as binary and downloaded with a PDF filename',async({page,browser})=>{
 await page.goto('/auth/login');await page.getByRole('button',{name:'Continue as Mia'}).click();
 await page.getByRole('textbox',{name:'Message Claude'}).fill('Create a one-page PDF called ag-ui-summary.pdf. Use a polished inline-CSS HTML layout with title AG-UI overview and three cards: Browser, Event stream, Agent. Explain briefly that AG-UI connects the interface and agent. No web research needed. Save as a real PDF.');
 await page.getByRole('button',{name:'Send message'}).click();await expect(page.getByRole('heading',{name:'Save ag-ui-summary.pdf?'})).toBeVisible({timeout:90000});
 const id=await page.evaluate(()=>localStorage.getItem('poc-thread'));const url=`/api/threads/${id}/documents/ag-ui-summary.pdf`;
 expect((await page.request.get(url)).status()).toBe(404);
 await page.getByRole('button',{name:'Approve change'}).click();await expect(page.locator('.status')).toHaveText('Complete',{timeout:90000});
 await page.getByRole('button',{name:'Changes',exact:true}).click();await expect(page.locator('.inspector').getByRole('link',{name:'Download ag-ui-summary.pdf'})).toBeVisible();
 const response=await page.request.get(url);expect(response.headers()['content-type']).toBe('application/pdf');expect(response.headers()['content-disposition']).toContain('ag-ui-summary.pdf');
 const bytes=await response.body();expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.toString('latin1')).toContain('%%EOF');expect(bytes.length).toBeGreaterThan(1000);writeFileSync('.local/pdf-proof.pdf',bytes);
 const tim=await browser.newContext({baseURL:'http://127.0.0.1:5273'});const other=await tim.newPage();await other.goto('/auth/login');await other.getByRole('button',{name:'Continue as Tim'}).click();expect((await other.request.get(url)).status()).toBe(404);await tim.close();
});
