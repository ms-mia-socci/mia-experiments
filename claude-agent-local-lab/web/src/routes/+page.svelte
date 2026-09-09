<script lang="ts">
  import { onMount } from 'svelte';
  import { HttpAgent } from '@ag-ui/client';
  import { renderMarkdown } from '$lib/markdown';
  let { data } = $props();
  type Message = {role:string;content:string;id?:string};
  type Approval = {filename?:string;id:string;reason:string;content:string;expiresAt:number};
  let threads = $state<{id:string;createdAt:string}[]>([]);
  let current = $state('');
  let messages = $state<Message[]>([]);
  let prompt = $state('');
  let busy = $state(false);
  let connected = $state(false);
  let status = $state('ready');
  let notice = $state('');
  let activity = $state<{id?:string;name:string;content:string}[]>([]);
  let approval = $state<Approval|null>(null);
  let patch = $state('');
  function showPreview(node:HTMLDialogElement){node.showModal();}
  let preview = $state<{filename:string;url:string}|null>(null);
  let documents = $state<{filename:string;url:string}[]>([]);
  let audit = $state<{filename?:string;decision:string;at:string}[]>([]);
  let cost = $state<number|null>(null);
  let testResult = $state<{passed:boolean;results:{name:string;passed:boolean}[]}|null>(null);
  let view = $state('activity');
  let events = $state<Record<string,any>[]>([]);
  let scrollArea = $state<HTMLDivElement>();
  const starter = 'Find and fix the shipping configuration bug. Run the tests before and after the change.';
  async function api(path:string,options?:RequestInit){
    const response=await fetch(path,options);
    if(!response.ok){let body;try{body=await response.json();}catch{}throw new Error(body?.message || `Request failed (${response.status})`);}
    return response.json();
  }
  async function refresh(){
    if(!current) return;
    const id=current;
    const item=await api(`/api/threads/${id}`);
    if(current!==id) return;
    documents=item.documents||[];events=item.events||[];status=item.status;approval=item.pendingApproval||null;patch=item.patch||'';audit=item.audit||[];cost=item.usage?.costUsd??cost;
    if(!connected){
      messages=item.messages||[];busy=item.status==='running';
      const live:Message[]=[];
      for(const event of events){
        if(event.type==='TEXT_MESSAGE_START')live.push({id:event.messageId,role:'assistant',content:''});
        if(event.type==='TEXT_MESSAGE_CONTENT'){const m=live.find(m=>m.id===event.messageId);if(m)m.content+=event.delta;}
        if(event.type==='CUSTOM' && event.name==='artifact'){testResult=event.value.tests;}
      }
      if(busy)messages=[...messages,...live];
      activity=events.filter(e=>e.type==='TOOL_CALL_START').map(e=>({id:e.toolCallId,name:e.toolCallName,content:events.find(r=>r.type==='TOOL_CALL_RESULT' && r.toolCallId===e.toolCallId)?.content||'Running…'}));
    }
  }
  async function select(id:string){
    if(connected) return;
    preview=null;current=id;localStorage.setItem('poc-thread',id);activity=[];events=[];testResult=null;cost=null;notice='';
    try{await refresh();}catch(e){notice=(e as Error).message;}
  }
  async function newThread(){
    try{const item=await api('/api/threads',{method:'POST'});threads=[item,...threads];await select(item.id);}
    catch(e){notice=(e as Error).message;}
  }
  async function send(){
    if(busy || !prompt.trim()) return;
    if(!current) await newThread();
    if(!current) return;
    const text=prompt.trim();prompt='';notice='';busy=true;connected=true;status='running';testResult=null;events=[];activity=[];
    const userMessage={id:crypto.randomUUID(),role:'user' as const,content:text};
    messages=[...messages,userMessage];
    const agent=new HttpAgent({url:`/api/threads/${current}/run`,threadId:current,initialMessages:[userMessage]});
    try{
      await agent.runAgent({}, {
        onEvent:({event})=>{events=[...events,event];},
        onTextMessageStartEvent:({event})=>{messages=[...messages,{id:event.messageId,role:'assistant',content:''}];},
        onTextMessageContentEvent:({event})=>{messages=messages.map(m=>m.id===event.messageId?{...m,content:m.content+event.delta}:m);scrollArea?.scrollTo({top:scrollArea.scrollHeight,behavior:'smooth'});},
        onToolCallStartEvent:({event})=>{activity=[...activity,{id:event.toolCallId,name:event.toolCallName,content:'Running…'}];},
        onToolCallResultEvent:({event})=>{activity=activity.map((a,i)=>a.id===event.toolCallId?{...a,content:event.content}:a);try{const result=JSON.parse(event.content);if(result.results)testResult=result;}catch{}},
        onCustomEvent:({event})=>{
          if(event.name==='document_saved')documents=[...documents.filter(d=>d.filename!==event.value.filename),event.value];
          if(event.name==='approval_requested') approval=event.value;
          if(event.name==='approval_resolved') approval=null;
          if(event.name==='artifact'){patch=event.value.patch;testResult=event.value.tests;cost=event.value.usage?.costUsd??null;}
        },
        onRunErrorEvent:({event})=>{notice=event.message;}
      });
    }catch(e){notice=(e as Error).message || 'Connection interrupted. Your session is saved; refresh to recover it.';}
    finally{connected=false;busy=false;await refresh().catch(()=>{});}
  }
  async function decide(decision:string){
    if(!approval) return;
    try{await api(`/api/threads/${current}/approval`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:approval.id,decision})});approval=null;}
    catch(e){notice=(e as Error).message;}
  }
  async function stop(){try{await api(`/api/threads/${current}/cancel`,{method:'POST'});notice='Stopping the current run…';}catch(e){notice=(e as Error).message;}}
  onMount(()=>{
    if(!data.user) return;
    void (async()=>{try{threads=await api('/api/threads');const saved=localStorage.getItem('poc-thread');if(saved && threads.some(t=>t.id===saved)) await select(saved);}catch(e){notice=(e as Error).message;}})();
    const timer=setInterval(()=>{if(current && !connected) void refresh().catch(()=>{});},2500);
    return ()=>clearInterval(timer);
  });
</script>

<svelte:head><title>Fieldwork · AG-UI local lab</title><meta name="description" content="A managed coding workspace for experiments with Claude."/></svelte:head>

{#if !data.user}
  <div class="landing">
    <nav><a class="brand" href="/"><span class="mark">f.</span> fieldwork</a><span class="eyebrow">MIA EXPERIMENTS / LOCAL LAB</span></nav>
    <main class="welcome">
      <div class="tag"><span class="dot"></span> AG-UI INTEGRATION LAB</div>
      <h1>A little room<br/>for <em>big ideas.</em></h1>
      <p>Explore the connection between Claude, AG-UI, and your browser. Follow every event and approve what changes.</p>
      <a class="primary signin" href="/auth/login">Open the local lab <span>↗</span></a>
      <div class="welcome-notes"><span>01 &nbsp; Local demo identities</span><span>02 &nbsp; Changes by approval</span><span>03 &nbsp; A record of the work</span></div>
    </main>
    <div class="preview"><div class="preview-head"><span class="dot"></span> A SMALL EXPERIMENT, END TO END</div><div class="preview-line">“Find and fix the shipping bug.”</div><div class="step"><span>✓</span><div>Read the project<small>Understand the requirements and files.</small></div></div><div class="step"><span>✓</span><div>Find the failing test<small>See the evidence behind the change.</small></div></div><div class="step pending"><span>↗</span><div>Ask before changing<small>You decide what gets written.</small></div></div><div class="preview-foot">POWERED BY CLAUDE <span>AGENTCORE DEV</span></div></div>
    <footer>Built for curiosity. Designed for control.<span>Local experiment · no AWS deployment</span></footer>
  </div>
{:else}
  <div class="app">
    <aside class="sidebar">
      <a class="brand" href="/"><span class="mark">f.</span> fieldwork</a>
      <div class="workspace-label">MIA EXPERIMENTS <span>LOCAL LAB</span></div>
      <button class="new" onclick={newThread} disabled={connected}>＋ &nbsp; New conversation</button>
      <div class="section-label">YOUR CONVERSATIONS</div>
      <div class="thread-list">{#each threads as thread,i}<button class:chosen={current===thread.id} disabled={connected} onclick={()=>select(thread.id)}><span>◌</span><div>Conversation<small>{new Date(thread.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})} · {thread.id.slice(0,6)}</small></div></button>{/each}{#if !threads.length}<p class="muted small">Your experiments will appear here.</p>{/if}</div>
      <div class="sidebar-bottom"><div class="policy"><span class="dot"></span> Local demo controls active</div><div class="user"><span class="avatar">{data.user.email.slice(0,1).toUpperCase()}</span><div>{data.user.email.split('@')[0]}<small>{data.user.email.split('@')[1]}</small></div><form action="/auth/logout" method="POST"><button title="Sign out" aria-label="Sign out">↪</button></form></div></div>
    </aside>
    <main class="main">
      <header><div><span class="eyebrow">LOCAL LAB / ASSISTANT</span><h2>Conversation</h2></div><span class="status"><span class="dot" class:working={busy}></span>{busy?'Working':status==='complete'?'Complete':'Ready when you are'}</span></header>
      <div class="workarea">
        <section class="conversation">
          <div class="messages" bind:this={scrollArea} aria-live="polite">
            {#if !messages.length}<div class="empty"><span class="empty-mark">✳</span><h1>What shall we<br/>explore?</h1><p>Research a topic, explore an idea, or ask a coding question. You can also try the sample project to see approvals in action.</p><button class="suggestion" onclick={()=>{prompt="Research what AG-UI does, using its official documentation. Explain how it connects a SvelteKit app to an agent and cite your sources.";void send();}}>Research the AG-UI framework <span>↗</span></button><button class="suggestion" onclick={()=>{prompt=starter;void send();}}>Find and fix the shipping bug <span>↗</span></button><div class="small muted">A fresh project copy is created for each conversation.</div></div>{/if}
            {#each messages as message}<article class:user-message={message.role==='user'}><div class="message-label">{message.role==='user'?'YOU':'CLAUDE'}{#if message.role==='assistant'}<span>✳</span>{/if}</div><div class="message-body" class:markdown={message.role==='assistant'}>{#if message.role==='assistant'}{@html renderMarkdown(message.content || 'Thinking…')}{:else}{message.content}{/if}</div></article>{/each}
            {#if busy}<div class="thinking"><span class="dot working"></span>{approval?'Waiting for your decision':'Claude is working…'}</div>{/if}
            {#if approval}<div class="approval"><div class="eyebrow">YOUR APPROVAL IS NEEDED</div><h3>Save {approval.filename || 'shipping.json'}?</h3><p>{approval.reason}</p><pre>{approval.content}</pre><div class="approval-actions"><button class="primary" onclick={()=>decide('approved')}>Approve change</button><button class="secondary" onclick={()=>decide('denied')}>Deny</button></div><small>This decision applies only to this exact change. Requests expire after 90 seconds.</small></div>{/if}
          </div>
          <div class="composer-area">{#if notice}<div class="notice" role="alert">{notice}</div>{/if}<form class="composer" onsubmit={e=>{e.preventDefault();void send();}}><textarea aria-label="Message Claude" placeholder="Ask a question or research a topic…" bind:value={prompt} maxlength={8000} rows="2" disabled={busy} onkeydown={e=>{if(e.key==='Enter' && !e.shiftKey){e.preventDefault();void send();}}}></textarea><div class="composer-bottom"><span>✳ &nbsp; Claude · Local lab</span>{#if busy}<button class="stop" type="button" onclick={stop}>■ Stop</button>{:else}<button class="send" aria-label="Send message" disabled={!prompt.trim()}>↑</button>{/if}</div></form><div class="composer-note">Review agent output. File changes always need your approval.</div></div>
        </section>
        <aside class="inspector"><div class="inspector-title">Behind the work <span>↗</span></div><div class="tabs"><button class:active={view==='activity'} onclick={()=>view='activity'}>Activity</button><button class:active={view==='changes'} onclick={()=>view='changes'}>Changes</button><button class:active={view==='events'} onclick={()=>view='events'}>Events</button><button class:active={view==='audit'} onclick={()=>view='audit'}>Decisions</button></div>
          <div class="inspector-content">{#if view==='activity'}<div class="section-label">PROJECT FILES</div><div class="file">▤ <span>README.md</span></div><div class="file">▤ <span>shipping.json</span></div><div class="section-label spaced">TOOL ACTIVITY</div>{#if !activity.length}<p class="muted small">As Claude works, you’ll see the tools it uses here.</p>{/if}{#each activity as item}<details class="tool"><summary>{item.name.replaceAll('_',' ')} <span>↗</span></summary><pre>{item.content}</pre></details>{/each}{#if testResult}<div class="test-panel"><strong>{testResult.passed?'✓ All tests passed':'○ Tests need attention'}</strong>{#each testResult.results as result}<div class:failed={!result.passed}>{result.passed?'✓':'×'} &nbsp; {result.name}</div>{/each}</div>{/if}
          {:else if view==='changes'}{#each documents as document}<a class="download" href={document.url} download={document.filename}>Download {document.filename} ↓</a>{#if document.filename.endsWith('.html')}<button class="preview-open" onclick={()=>preview=document}>Preview {document.filename} ↗</button>{/if}{/each}{#if patch}<a class="download" href={`/api/threads/${current}/patch`}>Download patch ↓</a><pre class="patch">{patch}</pre>{:else if !documents.length}<p class="muted small">Approved changes will appear here, ready to download as a patch.</p>{/if}
          {:else if view==='events'}<div class="section-label">AG-UI EVENT STREAM · {events.length}</div>{#if !events.length}<p class="muted small">Raw protocol events will appear here during a run.</p>{/if}{#each events as event}<details class="tool event"><summary>{event.type}{#if event.name} · {event.name}{/if}</summary><pre>{JSON.stringify(event,null,2)}</pre></details>{/each}{:else}{#if !audit.length}<p class="muted small">Approval decisions will be recorded here.</p>{/if}{#each audit as item}<div class="audit"><strong>{item.decision}</strong><small>{item.filename || 'shipping.json'} · {new Date(item.at).toLocaleTimeString()}</small></div>{/each}{/if}</div>
          <div class="controls"><div class="section-label">THIS WORKSPACE</div><p>✓ &nbsp; Separate local workspaces</p><p>✓ &nbsp; Web search and page reading</p><p>✓ &nbsp; File changes need approval</p><p>✓ &nbsp; Managed tests; no shell access</p>{#if cost!==null}<div class="usage">Last run <strong>${cost.toFixed(4)}</strong></div>{/if}</div>
        </aside>
      </div>
    </main>
  </div>
{/if}

{#if preview}<dialog class="document-preview" use:showPreview onclose={()=>preview=null} aria-label={preview.filename}><div class="preview-toolbar"><strong>{preview.filename}</strong><a href={preview.url} download={preview.filename}>Download ↓</a><button onclick={()=>preview=null}>Close preview ×</button></div><iframe title={preview.filename} src={preview.url+'?preview=1'} sandbox="" referrerpolicy="no-referrer"></iframe><small>Static preview · scripts and external resources are disabled.</small></dialog>{/if}

<style>
  .preview-open{width:100%;margin:6px 0 18px;border:1px solid #d7ddcd;border-radius:6px;padding:10px;background:white;color:#526345;font-size:11px}.document-preview::backdrop{background:#20261ecc}.document-preview{background:#faf9f6;border:0;padding:0;border-radius:12px;width:92vw;height:92vh;max-width:none;max-height:none;display:flex;flex-direction:column;overflow:hidden}.preview-toolbar{display:flex;align-items:center;gap:24px;padding:16px 22px;font-size:13px}.preview-toolbar strong{margin-right:auto}.preview-toolbar button{background:white;border:1px solid #d7ddcd;padding:8px 12px;border-radius:6px}.document-preview iframe{flex:1;width:100%;border:0;background:white}.document-preview>small{padding:10px 22px;color:#7d8574;font-size:10px}

  .message-body.markdown{white-space:normal}.markdown :global(p){margin:0 0 16px}.markdown :global(h1),.markdown :global(h2),.markdown :global(h3){font-family:Georgia,serif;font-weight:400;font-size:22px;letter-spacing:-.4px;margin:24px 0 14px}.markdown :global(table){border-collapse:collapse;width:100%;font-size:12px;margin:18px 0}.markdown :global(th),.markdown :global(td){border-bottom:1px solid #dfe3d7;padding:9px;text-align:left}.markdown :global(th){background:#f0f2eb;font-weight:500}.markdown :global(code){font-size:11px;background:#eef0e8;padding:2px 4px;border-radius:3px}.markdown :global(pre){overflow:auto;background:#eef0e8;padding:14px;border-radius:7px}.markdown :global(a){text-decoration:underline}.markdown :global(ul),.markdown :global(ol){padding-left:22px}
  :global(*){box-sizing:border-box} :global(body){margin:0;background:#faf9f6;color:#292d2a;font-family:Arial,Helvetica,sans-serif;font-size:14px} :global(button),:global(textarea),:global(input){font:inherit} :global(button),:global(a){-webkit-tap-highlight-color:transparent} :global(button){cursor:pointer} :global(button:disabled){opacity:.45;cursor:not-allowed} :global(a){color:inherit;text-decoration:none} :global(button:focus-visible),:global(a:focus-visible),:global(textarea:focus-visible){outline:2px solid #ba593b;outline-offset:4px}
  .brand{display:flex;align-items:center;gap:10px;font-size:24px;font-weight:600;letter-spacing:-1.2px}.mark{display:grid;place-items:center;background:#bc5d40;color:#fff;width:34px;height:34px;border-radius:9px;font-family:Georgia,serif;font-style:italic;font-size:28px;padding-bottom:5px}.eyebrow,.section-label,.workspace-label,.tag{font-size:10px;font-weight:600;letter-spacing:1.5px;color:#7b8179}.dot{display:inline-block;width:6px;height:6px;background:#798c68;border-radius:50%;flex-shrink:0}.working{background:#bc5d40;animation:pulse 1.5s infinite}@keyframes pulse{50%{opacity:.3}}.primary{background:#b65538;border:1px solid #b65538;color:white;padding:12px 18px;border-radius:7px;font-weight:600}.secondary{background:white;border:1px solid #d9dcd4;padding:12px 18px;border-radius:7px}.muted{color:#838980}.small{font-size:12px;line-height:1.7}.landing{min-height:100vh;max-width:1440px;margin:auto;padding:40px 6%;position:relative;display:grid;grid-template-columns:1.3fr 1fr;gap:70px}.landing nav{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center}.welcome{align-self:center;padding:30px 0 70px}.tag{display:flex;gap:10px;align-items:center;color:#7d886f}.welcome h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(50px,5.5vw,80px);line-height:1.08;letter-spacing:-3px;margin:30px 0}.welcome em{color:#ad593f;font-weight:400}.welcome>p{font-size:17px;line-height:1.8;color:#72786f;max-width:410px}.signin{display:flex;justify-content:space-between;max-width:320px;margin:32px 0 45px}.welcome-notes{display:flex;flex-direction:column;gap:13px;font-size:12px;color:#767d73}.preview{align-self:center;background:white;border:1px solid #e1e2da;border-radius:14px;box-shadow:0 15px 70px #34432a09;transform:rotate(1deg);max-width:410px}.preview-head{font-size:9px;letter-spacing:1.5px;padding:22px;border-bottom:1px solid #eee;display:flex;gap:9px;align-items:center}.preview-line{padding:30px 24px;font-family:Georgia,serif;font-size:22px}.step{display:flex;gap:17px;padding:20px 25px}.step>span{width:28px;height:28px;border-radius:50%;background:#edf1e8;color:#70815f;display:grid;place-items:center}.step small{display:block;color:#8b9087;font-size:11px;margin-top:7px}.step.pending{background:#fbf2ea;margin:0 15px 25px;padding:20px 10px;border-radius:8px}.step.pending>span{background:#f1dacb;color:#ac5b3e}.preview-foot{display:flex;justify-content:space-between;padding:18px 22px;border-top:1px solid #eee;font-size:8px;letter-spacing:1.1px;color:#92988e}.landing footer{grid-column:1/-1;display:flex;justify-content:space-between;font-size:11px;color:#92988e;border-top:1px solid #e4e5de;padding-top:25px}.app{height:100dvh;display:flex}.sidebar{width:240px;background:#f0f1eb;border-right:1px solid #dedfd6;display:flex;flex-direction:column;padding:28px 18px 16px;flex-shrink:0}.sidebar .brand{margin:0 9px 35px}.workspace-label{display:flex;justify-content:space-between;align-items:center;margin:0 9px 24px;font-size:9px}.workspace-label span{letter-spacing:.8px;border:1px solid #d7dacc;padding:3px 5px;border-radius:4px}.new{background:#fff;border:1px solid #d7dacf;border-radius:7px;text-align:left;padding:12px;font-size:12px;margin-bottom:30px;box-shadow:0 2px 2px #00000003}.section-label{font-size:9px;letter-spacing:1.2px}.thread-list{overflow:auto;margin-top:15px;flex:1}.thread-list>button{border:0;background:transparent;display:flex;text-align:left;width:100%;gap:10px;padding:12px 10px;font-size:12px;border-radius:7px;color:#646c5e;margin-bottom:5px}.thread-list .chosen{background:#e2e6da;color:#35402d}.thread-list small{display:block;font-size:10px;color:#8a9381;margin-top:6px}.sidebar-bottom{margin-top:auto}.policy{font-size:10px;color:#7a846f;display:flex;align-items:center;gap:8px;padding:14px 6px;border-bottom:1px solid #dcdfd3}.user{display:flex;align-items:center;gap:10px;padding:18px 3px 0;font-size:11px}.avatar{display:grid;place-items:center;background:#dce2d4;color:#617052;width:31px;height:31px;border-radius:50%;font-family:Georgia,serif}.user small{display:block;color:#8b9384;font-size:10px;margin-top:4px}.user form{margin-left:auto}.user button{border:0;background:transparent;color:#79856e;font-size:20px}.main{flex:1;min-width:0;display:flex;flex-direction:column}.main header{height:99px;padding:25px 34px;border-bottom:1px solid #e4e5de;display:flex;align-items:center;justify-content:space-between}.main header .eyebrow{font-size:9px}.main h2{font-size:18px;font-weight:500;letter-spacing:-.4px;margin:9px 0 0}.status{font-size:10px;display:flex;gap:7px;align-items:center;color:#7c8474}.workarea{display:flex;flex:1;min-height:0}.conversation{display:flex;flex-direction:column;flex:1;min-width:0}.messages{flex:1;overflow:auto;padding:35px clamp(24px,4vw,65px)}.empty{max-width:460px;margin:5vh auto 0}.empty-mark{color:#bd6348;font-size:45px}.empty h1{font-family:Georgia,serif;font-size:44px;letter-spacing:-1.5px;line-height:1.1;font-weight:400;margin:24px 0 18px}.empty p{font-size:13px;color:#858b80;line-height:1.9;max-width:350px}.suggestion{display:flex;justify-content:space-between;gap:20px;width:100%;max-width:360px;border:1px solid #dfe1d6;border-radius:8px;padding:16px;background:white;color:#4e5846;font-size:12px;margin:28px 0 15px}.suggestion span{color:#aa6146}article{padding:10px 0 24px;margin-bottom:20px}.message-label{font-size:9px;font-weight:600;letter-spacing:1.4px;color:#a4644a;display:flex;gap:10px;align-items:center;margin-bottom:14px}.user-message .message-label{color:#7a8670}.message-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.85;color:#4a5243}.user-message{background:#f0f2eb;border-radius:9px;padding:20px}.thinking{display:flex;align-items:center;gap:10px;font-size:12px;color:#929889;margin:10px 0 25px}.composer-area{padding:12px 30px 18px}.composer{border:1px solid #daddd0;border-radius:12px;padding:16px;background:white;box-shadow:0 3px 10px #34432a04}.composer textarea{width:100%;resize:none;border:none;background:transparent;outline:none;font-size:13px;color:#424c38;line-height:1.7}.composer textarea::placeholder{color:#a0a698}.composer-bottom{display:flex;align-items:center;justify-content:space-between;margin-top:9px}.composer-bottom>span{font-size:10px;color:#949c89}.send{border:0;background:#b85b3f;color:white;width:31px;height:31px;border-radius:7px;font-size:22px}.stop{border:1px solid #dddfd4;border-radius:6px;background:#f7f8f3;padding:7px 12px;font-size:11px}.composer-note{text-align:center;font-size:9px;color:#989e90;margin-top:10px}.notice{font-size:12px;color:#914b36;background:#faeee7;border-radius:6px;padding:12px;margin-bottom:10px}.inspector{width:350px;border-left:1px solid #e2e4d9;background:#f7f8f3;display:flex;flex-direction:column;flex-shrink:0}.inspector-title{display:flex;justify-content:space-between;padding:23px 22px;font-size:12px;font-weight:600;color:#66735a}.inspector-title span{color:#a7ae9d}.tabs{display:flex;padding:0 18px;border-bottom:1px solid #e2e5d9}.tabs button{flex:1;border:0;border-bottom:2px solid transparent;background:transparent;padding:12px 0;font-size:11px;color:#9aa18f}.tabs .active{border-color:#768965;color:#526345}.inspector-content{padding:25px 22px;overflow:auto;flex:1}.file{display:flex;align-items:center;gap:9px;margin-top:17px;font-size:13px;color:#a1aa95}.file span{color:#69775c;font-size:11px}.spaced{margin-top:35px}.tool{padding:13px 0;border-bottom:1px solid #e1e5d8;font-size:11px;color:#718062}.event summary{font-size:9px;overflow-wrap:anywhere}.tool summary{cursor:pointer;list-style:none;text-transform:capitalize;display:flex;justify-content:space-between}.tool pre,.patch{white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px;line-height:1.6}.controls{padding:24px 22px;border-top:1px solid #e1e4d8}.controls p{font-size:10px;color:#8a967c;margin:13px 0}.usage{font-size:10px;color:#879479;display:flex;justify-content:space-between;border-top:1px solid #e2e5da;padding-top:12px;margin-top:18px}.usage strong{font-weight:500}.approval{padding:22px;background:#fbf0e7;border:1px solid #e7cbb9;border-radius:9px;margin:25px 0}.approval .eyebrow{color:#a16a4c}.approval h3{font-family:Georgia,serif;font-weight:400;font-size:23px;margin:12px 0}.approval p{font-size:12px;line-height:1.8;color:#8c715d}.approval pre{max-height:280px;overflow:auto;font-size:11px;white-space:pre-wrap;background:#fffaf5;border-radius:6px;padding:15px}.approval-actions{display:flex;gap:10px;margin:18px 0}.approval small{font-size:10px;color:#a18a74;line-height:1.6;display:block}.test-panel{margin-top:25px;background:#eef2e7;padding:15px;border-radius:7px;color:#758864;font-size:10px}.test-panel strong{display:block;margin-bottom:15px}.test-panel>div{margin-top:9px}.test-panel .failed{color:#b26846}.download{display:block;border:1px solid #d7ddcd;border-radius:6px;padding:10px;font-size:11px;text-align:center;color:#6e805b}.patch{margin-top:20px;color:#6d8058}.audit{padding:15px 0;border-bottom:1px solid #e2e6d9;color:#748366}.audit strong{font-size:12px;text-transform:capitalize;font-weight:500}.audit small{display:block;font-size:10px;margin-top:6px;color:#939d88}
  @media(min-width:1500px){.messages{padding-left:8%;padding-right:8%}.inspector{width:340px}}@media(max-width:1100px){.sidebar{width:205px}.inspector{width:260px}.messages{padding:25px}.main header{padding:22px}.composer-area{padding:12px 20px}.landing{gap:35px}}@media(max-width:900px){.inspector{display:none}.landing{grid-template-columns:1fr}.preview{display:none}.welcome{padding:40px 0}.landing footer{gap:25px}.landing nav>.eyebrow{font-size:8px}}@media(max-width:600px){.sidebar{width:65px;padding:22px 9px}.sidebar .brand{font-size:0;margin:0 5px 25px}.sidebar .brand .mark{font-size:28px;min-width:30px}.workspace-label,.sidebar .section-label,.thread-list,.sidebar-bottom{display:none}.new{font-size:0;min-height:38px;position:relative}.new:after{content:'＋';font-size:22px;position:absolute;inset:5px;text-align:center}.main header{height:85px;padding:16px}.main h2{font-size:16px}.status{font-size:0}.messages{padding:20px}.empty h1{font-size:37px}.composer-area{padding:10px}.composer-note{font-size:8px}.composer-bottom>span{font-size:9px}.approval{padding:16px}.approval-actions{flex-direction:column}.welcome h1{font-size:58px}.landing footer{font-size:9px}.landing{padding:28px 7%}}
</style>
