import {chromium} from 'playwright';
import {previewHtml,previewPolicy} from '../../shared/html.js';
export async function renderPdf(html:string,signal?:AbortSignal){
 signal?.throwIfAborted();
 const browser=await chromium.launch({executablePath:process.env.LAB_BROWSER_EXECUTABLE,headless:true,timeout:20000});
 const stop=()=>{void browser.close();};const deadline=setTimeout(stop,30000);signal?.addEventListener('abort',stop,{once:true});
 try{
  signal?.throwIfAborted();
  const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'});
  // No document is permitted to read the network, local files, or app endpoints.
  await context.route('**/*',route=>route.abort());
  const page=await context.newPage();
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="${previewPolicy}">${previewHtml(html)}`,{waitUntil:'load',timeout:20000});
  const bytes=await page.pdf({format:'A4',printBackground:true,margin:{top:'15mm',bottom:'15mm',left:'12mm',right:'12mm'}});
  if(bytes.length>20_000_000)throw new Error('PDF exceeds the 20 MB document limit');
  signal?.throwIfAborted();return bytes;
 }finally{clearTimeout(deadline);signal?.removeEventListener('abort',stop);await browser.close();}
}
