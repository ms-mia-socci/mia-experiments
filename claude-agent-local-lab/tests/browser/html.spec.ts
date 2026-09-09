import {test,expect} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
test('HTML infographic saves with approval and renders in an isolated preview',async({page})=>{
 await page.goto('/auth/login');await page.getByRole('button',{name:'Continue as Mia'}).click();
 await page.getByRole('textbox',{name:'Message Claude'}).fill('Create a small, self-contained HTML infographic called ag-ui-overview.html with inline CSS. Title: AG-UI overview. Show three connected cards: Browser, Events, Agent. No research needed. Save it as HTML.');
 await page.getByRole('button',{name:'Send message'}).click();await expect(page.getByRole('heading',{name:'Save ag-ui-overview.html?'})).toBeVisible({timeout:90000});
 await page.getByRole('button',{name:'Approve change'}).click();await expect(page.locator('.status')).toHaveText('Complete',{timeout:60000});
 await page.getByRole('button',{name:'Changes',exact:true}).click();await page.getByRole('button',{name:'Preview ag-ui-overview.html'}).click();
 await expect(page.frameLocator('iframe').getByText('AG-UI overview',{exact:false}).first()).toBeVisible();
 await expect(page.locator('iframe')).toHaveAttribute('sandbox','');
 await page.screenshot({path:'.local/html-preview.png',fullPage:true});
 const id=await page.evaluate(()=>localStorage.getItem('poc-thread'));
 const response=await page.request.get(`/api/threads/${id}/documents/ag-ui-overview.html`);expect(response.headers()['content-disposition']).toContain('attachment; filename="ag-ui-overview.html"');expect(await response.text()).toMatch(/<html|<!doctype/i);
});
test('preview strips active markup, blocks remote resources and enforces ownership',async({page,browser})=>{
 await page.goto('/auth/login');await page.getByRole('button',{name:'Continue as Mia'}).click();
 const thread=await (await page.request.post('/api/threads',{headers:{Origin:'http://127.0.0.1:5273'}})).json();
 const content='<html><head><style>body{color:rgb(1, 2, 3);background-image:url(https://preview-attack.invalid/a)}</style><meta http-equiv="refresh" content="0;url=https://preview-attack.invalid/"></head><body><h1>Preview fixture</h1><script>parent.document.body.dataset.compromised="yes"</script><img src="https://preview-attack.invalid/image" onerror="alert(1)"><iframe src="/api/threads"></iframe><a href="/api/threads" target="_top">Click me</a><form action="/api/threads" method="post"><button>Submit</button></form></body></html>';
 const db=new DatabaseSync('.local/lab.sqlite');db.prepare('INSERT INTO items(thread,sk,data) VALUES (?,?,?)').run(thread.id,'DOCUMENT#fixture.html',JSON.stringify({filename:'fixture.html',content}));db.close();
 await page.evaluate(id=>localStorage.setItem('poc-thread',id),thread.id);await page.reload();await page.getByRole('button',{name:'Changes',exact:true}).click();
 const responses:string[]=[];const failures:string[]=[];page.on('response',r=>{if(r.url().includes('preview-attack.invalid'))responses.push(r.url());});page.on('requestfailed',r=>{if(r.url().includes('preview-attack.invalid'))failures.push(r.failure()?.errorText||'');});
 await page.getByRole('button',{name:'Preview fixture.html'}).click();await expect(page.frameLocator('iframe').getByRole('heading',{name:'Preview fixture'})).toBeVisible();
 expect(await page.locator('body').getAttribute('data-compromised')).toBeNull();expect(responses).toEqual([]);expect(failures.some(reason=>/csp/i.test(reason))).toBeTruthy();
 const url=`/api/threads/${thread.id}/documents/fixture.html?preview=1`;const response=await page.request.get(url);expect(response.headers()['content-security-policy']).toContain("sandbox; default-src 'none'");expect(await response.text()).not.toMatch(/<script|<meta|<iframe|<form|onerror|href=/i);
 const anonymous=await browser.newContext({baseURL:'http://127.0.0.1:5273'});expect((await anonymous.request.get(url)).status()).toBe(401);await anonymous.close();
 const cleanup=new DatabaseSync('.local/lab.sqlite');cleanup.prepare('DELETE FROM items WHERE thread=?').run(thread.id);cleanup.prepare("DELETE FROM items WHERE thread='USER#mia' AND json_extract(data,'$.id')=?").run(thread.id);cleanup.close();
});
