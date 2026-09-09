import {test,expect} from '@playwright/test';
test('web research streams tools and citations without unrelated shipping tests',async({page})=>{
 await page.goto('/auth/login');await page.getByRole('button',{name:'Continue as Mia'}).click();
 await page.getByRole('button',{name:'Research the AG-UI framework'}).click();
 await expect(page.getByRole('button',{name:'Stop',exact:false})).toBeVisible();
 await expect(page.locator('.status')).toHaveText('Complete',{timeout:180000});
 const id=await page.evaluate(()=>localStorage.getItem('poc-thread'));
 const state=await (await page.request.get(`/api/threads/${id}`)).json();
 expect(state.events.some((e:any)=>e.type==='TOOL_CALL_START' && e.toolCallName==='WebSearch')).toBeTruthy();
 expect(state.events.some((e:any)=>e.type==='TOOL_CALL_RESULT')).toBeTruthy();
 expect(state.events.some((e:any)=>e.name==='approval_requested')).toBeFalsy();
 expect(state.events.find((e:any)=>e.name==='artifact').value.tests).toBeNull();
 await expect(page.locator('.markdown a[href^="https://"]').first()).toBeVisible();
 await expect(page.locator('.test-panel')).toHaveCount(0);
 await page.screenshot({path:'.local/research.png',fullPage:true});
 console.log(JSON.stringify({tools:state.events.filter((e:any)=>e.type==='TOOL_CALL_START').map((e:any)=>e.toolCallName),cost:state.usage.costUsd}));
});
