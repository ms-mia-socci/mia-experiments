<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { MemoryItem, MemorySettings } from "$lib/memory-policy";
  let { data } = $props();
  let settings = $state<MemorySettings>(untrack(() => ({ ...data.settings })));
  let busy = $state(false),
    notice = $state(""),
    records = $state<MemoryItem[] | null>(null),
    confirmReset = $state(false);
  let status = $state("");
  onMount(() => {
    void fetch("/api/memory")
      .then((r) => r.json())
      .then((v) => (status = v.status?.message || ""))
      .catch(() => {});
  });
  async function save() {
    busy = true;
    notice = "";
    try {
      const r = await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!r.ok) throw Error("Could not save settings");
      notice = "Settings saved. Changes apply to future agent requests.";
    } catch (e) {
      notice = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function inspect() {
    busy = true;
    try {
      const r = await fetch("/api/memory?inspect=1");
      if (!r.ok) throw Error();
      const v = await r.json();
      if (v.unavailable) throw Error();
      records = v.records || [];
      notice = "";
    } catch {
      notice = "AWS Memory is unavailable. Your settings are still saved.";
    } finally {
      busy = false;
    }
  }
  async function reset() {
    busy = true;
    try {
      const r = await fetch("/api/memory", { method: "DELETE" });
      if (!r.ok) throw Error();
      const v = await r.json();
      records = [];
      notice = v.message;
      confirmReset = false;
    } catch {
      notice = "Could not reset memory. Please try again.";
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Profile & memory — Fieldwork</title></svelte:head>
<main class="settings-page">
  <a class="back" href="/">← Back to workspace</a>
  <header>
    <span class="profile-avatar">{data.user.name[0]}</span>
    <div>
      <p class="eyebrow">YOUR PROFILE</p>
      <h1>{data.user.name}</h1>
      <p>Local demo identity</p>
    </div>
    <form action="/auth/logout" method="POST">
      <button>Switch person</button>
    </form>
  </header>
  <section>
    <h2>Memory settings</h2>
    <p>
      Choose what carries forward. These settings belong to you and apply to
      Strands, Claude, and Codex.
    </p>
    <p class="service">
      {data.configured
        ? "Configured for AgentCore Memory · AWS us-east-1"
        : "AgentCore Memory is not configured yet"}
    </p>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label
        ><input
          type="checkbox"
          bind:checked={settings.enabled}
          disabled={busy}
        /><span
          ><strong>Use cloud memory</strong><small
            >Save new conversation text to AWS Memory. Off means no memory reads
            or writes during chats; local conversation history still works.</small
          ></span
        ></label
      >
      <label
        ><input
          type="checkbox"
          bind:checked={settings.crossSession}
          disabled={busy || !settings.enabled}
        /><span
          ><strong>Remember across conversations</strong><small
            >Extract preferences and summaries from new turns and recall them in
            later conversations. Off stores conversation events only, without
            new long-term extraction.</small
          ></span
        ></label
      >
      <label
        ><input
          type="checkbox"
          bind:checked={settings.shareAcrossAgents}
          disabled={busy || !settings.enabled || !settings.crossSession}
        /><span
          ><strong>Share memory between agent frameworks</strong><small
            >Let Strands, Claude, and Codex recall each other’s memories about
            you. Off keeps recall within the selected framework. Never shares
            with another person.</small
          ></span
        ></label
      >
      <fieldset disabled={busy || !settings.enabled || !settings.crossSession}>
        <legend>What agents can recall</legend>
        <label
          ><input type="checkbox" bind:checked={settings.usePreferences} /><span
            ><strong>Preferences</strong><small
              >Writing style, preferred formats, and ways you like to work.</small
            ></span
          ></label
        >
        <label
          ><input type="checkbox" bind:checked={settings.useSummaries} /><span
            ><strong>Conversation summaries</strong><small
              >Relevant context from prior tasks. These controls filter recall,
              not AWS extraction.</small
            ></span
          ></label
        >
      </fieldset>
      <p class="note">
        Only new turns are sent after you enable memory; old chats are not
        backfilled. Uploaded file bytes are not sent to Memory, but conversation
        text may discuss their contents. Raw events expire after 7 days;
        extracted memories remain until deleted. Existing chat messages and
        context already sent to a running agent are not erased by changing these
        settings.
      </p>
      <button class="primary" disabled={busy}>Save settings</button>
    </form>
  </section>
  <section>
    <h2>Your saved memories</h2>
    <p>
      Extraction happens in the background and may take a few minutes. Inspect
      shows your current saved memories, including kinds you have disabled for
      recall.
    </p>
    <button onclick={inspect} disabled={busy || !data.configured}
      >Inspect / refresh memories</button
    >
    {#if status}<p class="note">Last memory activity: {status}</p>{/if}
    {#if records}{#if !records.length}<p>
          No extracted memories yet.
        </p>{/if}{#each records as memory}<article>
          <small>{memory.framework} · {memory.kind}</small>
          <p>{memory.text}</p>
        </article>{/each}{/if}
  </section>
  <section>
    <h2>Start fresh</h2>
    <p>
      Reset stops recall of all prior memories immediately and requests deletion
      of your AWS events and extracted records. It keeps local chat history and
      your settings. A running chat may still contain context it already
      received.
    </p>
    {#if confirmReset}<div class="confirm">
        <p>Reset all of your memory across all three frameworks?</p>
        <button class="danger" disabled={busy} onclick={reset}
          >Reset my memory</button
        ><button disabled={busy} onclick={() => (confirmReset = false)}
          >Cancel</button
        >
      </div>{:else}<button
        class="danger"
        disabled={busy}
        onclick={() => (confirmReset = true)}>Reset memory…</button
      >{/if}
  </section>
  {#if notice}<p role="status" class="notice">{notice}</p>{/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #faf9f5;
    color: #30382d;
    font-family: Inter, system-ui, sans-serif;
  }
  .settings-page {
    max-width: 820px;
    margin: auto;
    padding: 40px 28px 80px;
  }
  .back {
    color: #6d7e5d;
    text-decoration: none;
    font-size: 14px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin: 36px 0;
  }
  header form {
    margin-left: auto;
  }
  .profile-avatar {
    display: grid;
    place-items: center;
    width: 58px;
    height: 58px;
    border-radius: 50%;
    background: #e1e7d8;
    font: 28px Georgia;
  }
  h1 {
    font: 36px Georgia;
    margin: 4px 0;
  }
  h2 {
    font: 26px Georgia;
    margin: 0 0 16px;
  }
  p {
    line-height: 1.65;
    color: #77836c;
    margin: 8px 0;
  }
  .eyebrow {
    font-size: 10px;
    letter-spacing: 2px;
  }
  section {
    border-top: 1px solid #dfe3d8;
    padding: 30px 0;
  }
  label {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    margin: 24px 0;
  }
  input {
    margin-top: 4px;
    accent-color: #6e805b;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
  strong {
    display: block;
    font-weight: 600;
    font-size: 15px;
  }
  small {
    display: block;
    line-height: 1.6;
    color: #77836c;
    margin-top: 5px;
    font-size: 13px;
  }
  button {
    border: 1px solid #d3dcc8;
    padding: 10px 16px;
    border-radius: 7px;
    background: white;
    color: #58664c;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .primary {
    background: #6e805b;
    color: white;
  }
  .danger {
    color: #a35c44;
  }
  .note {
    font-size: 12px;
    line-height: 1.7;
  }
  .service {
    font-size: 12px;
  }
  fieldset {
    border: 1px solid #dfe3d8;
    border-radius: 8px;
    padding: 8px 18px;
    margin: 20px 0;
  }
  fieldset:disabled {
    opacity: 0.55;
  }
  legend {
    font-size: 13px;
  }
  article {
    padding: 16px;
    background: #f0f3e9;
    border-radius: 8px;
    margin: 16px 0;
  }
  article p {
    color: #414b39;
    white-space: pre-wrap;
  }
  .notice {
    position: sticky;
    bottom: 16px;
    background: #e8eedf;
    padding: 16px;
    border-radius: 8px;
    color: #414b39;
  }
  .confirm button {
    margin-right: 10px;
  }
  @media (max-width: 500px) {
    header {
      flex-wrap: wrap;
    }
    header form {
      margin-left: 0;
    }
  }
</style>
