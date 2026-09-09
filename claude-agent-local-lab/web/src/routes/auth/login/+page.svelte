<svelte:head><title>Choose an identity · Fieldwork local lab</title></svelte:head>
<main>
  <span>FIELDWORK / LOCAL LAB</span>
  <h1>Pick a seat.</h1>
  <p>Two demo identities for testing private conversations and approvals. This is a local simulation, with no AWS or organizational sign-in.</p>
  <form method="POST"><button name="user" value="mia">Continue as Mia <span>↗</span></button><button name="user" value="tim">Continue as Tim <span>↗</span></button></form>
  <small>Claude calls use the configured Anthropic API key. Everything else stays in this lab.</small>
</main>
<style>
  :global(body){margin:0;background:#faf9f6;color:#292d2a;font-family:Arial,sans-serif}main{max-width:430px;margin:15vh auto;padding:30px}main>span{font-size:10px;letter-spacing:2px;color:#8b927f}h1{font:52px Georgia,serif;letter-spacing:-2px;font-weight:400}p{color:#7d8574;font-size:14px;line-height:1.8}form{display:grid;gap:12px;margin:30px 0}button{background:white;border:1px solid #daddd1;padding:18px;text-align:left;border-radius:8px;cursor:pointer;font-size:14px;color:#536148;display:flex;justify-content:space-between}button:first-child{background:#b65b3e;border-color:#b65b3e;color:white}small{font-size:11px;line-height:1.8;color:#929b88}button:focus-visible{outline:2px solid #b65b3e;outline-offset:3px}
</style>
