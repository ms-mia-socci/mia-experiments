<script lang="ts" module>
  function showDialog(node: HTMLDialogElement) {
    node.showModal();
  }
</script>

<script lang="ts">
  import ConversationTitle from "$lib/components/ConversationTitle.svelte";
  import ConversationRow from "$lib/components/ConversationRow.svelte";
  import AttachFiles from "$lib/components/AttachFiles.svelte";
  import {
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_FILES,
    UPLOAD_ACCEPT,
    type AttachmentRef,
  } from "$lib/attachments";
  import UsageIndicator from "$lib/components/UsageIndicator.svelte";
  import { latestUsage } from "$lib/usage";
  import * as Tool from "$lib/components/ai-elements/tool";
  import * as Sources from "$lib/components/ai-elements/sources";
  import * as Plan from "$lib/components/ai-elements/plan";
  import { citedSources, toolActivity } from "$lib/activity";
  import { onMount } from "svelte";
  import { HttpAgent } from "@ag-ui/client";
  import * as PromptInput from "$lib/components/ai-elements/prompt-input";
  import * as Conversation from "$lib/components/ai-elements/conversation";
  import * as Message from "$lib/components/ai-elements/message";
  import * as Confirmation from "$lib/components/ai-elements/confirmation";
  import { Suggestion } from "$lib/components/ai-elements/suggestion";
  import { Button } from "$lib/components/ui/button";
  import {
    ArrowUpRight,
    ArrowRight,
    Plus,
    Compass,
    GitBranch,
    FileText,
    LogOut,
    ShieldCheck,
    Sparkles,
    PanelRight,
    PanelLeftClose,
    Download,
  } from "@lucide/svelte";
  import { catalog, frameworkName, type Framework } from "$lib/catalog";
  import type {
    Thread,
    Message as ChatMessage,
    Recommendation,
    Approval,
  } from "$lib/server/store";
  import "$lib/fieldwork.css";
  let { data } = $props();
  type Entry = {
    id: string;
    title: string;
    framework: Framework | null;
    phase: string;
    pinned?: boolean;
    archived?: boolean;
  };
  let threads = $state<Entry[]>([]),
    current = $state<Thread | null>(null),
    messages = $state<ChatMessage[]>([]),
    events = $state<any[]>([]),
    prompt = $state(""),
    busy = $state(false),
    connected = $state(false),
    notice = $state(""),
    showInspector = $state(true),
    tab = $state("Route"),
    recommendation = $state<Recommendation | null>(null),
    approval = $state<Approval | null>(null),
    documents = $state<{ filename: string; url: string }[]>([]),
    preview = $state<{ filename: string; url: string } | null>(null);
  let draftFiles = $state<PromptInput.PromptInputAttachmentData[]>([]);
  let uploads = $state<AttachmentRef[]>([]);
  let uploading = $state(false);
  let sidebarCollapsed = $state(false);
  function setSidebarCollapsed(value: boolean) {
    sidebarCollapsed = value;
    localStorage.setItem("fieldwork-sidebar-collapsed", String(value));
  }
  const usage = $derived(latestUsage(events));
  const tools = $derived(toolActivity(events, busy));
  const activeName = $derived(
    current?.phase === "routing"
      ? "Strands coordinator"
      : frameworkName(current?.framework || "strands"),
  );
  async function api(path: string, options: RequestInit = {}) {
    const r = await fetch(path, options);
    const value = await r.json();
    if (!r.ok) throw new Error(value.message || "Request failed");
    return value;
  }
  let historyQuery = $state("");
  let showArchived = $state(false);
  let historyRequest = 0;
  async function loadThreads() {
    const request = ++historyRequest;
    const params = new URLSearchParams({
      q: historyQuery,
      archived: showArchived ? "1" : "0",
    });
    const result = await api(
      historyQuery || showArchived ? `/api/threads?${params}` : "/api/threads",
    );
    if (request === historyRequest) threads = result;
  }
  async function filterHistory() {
    try {
      await loadThreads();
    } catch {
      notice = "Could not load conversation history.";
    }
  }
  async function editThread(
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ) {
    try {
      await api(`/api/threads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (current?.id === id) {
        if (patch.archived) home();
        else await refresh();
      }
      await loadThreads();
    } catch (e) {
      notice = (e as Error).message;
      throw e;
    }
  }

  let refreshVersion = 0;
  async function refresh() {
    if (!current) return;
    const id = current.id;
    const version = ++refreshVersion;
    const value = await api(`/api/threads/${id}`);
    if (current?.id !== id || version !== refreshVersion) return;
    current = value;
    recommendation = current!.recommendation;
    approval =
      current!.pendingApproval?.status === "pending"
        ? current!.pendingApproval
        : null;
    documents = value.documents;
    uploads = value.uploads || [];
    if (!connected) {
      messages = current!.messages;
      events = value.events;
      busy = current!.status === "running";
      if (busy) {
        const live: ChatMessage[] = [];
        for (const e of events) {
          if (e.type === "TEXT_MESSAGE_START")
            live.push({
              id: e.messageId,
              role: "assistant",
              content: "",
              agent:
                current!.phase === "routing"
                  ? "coordinator"
                  : current!.framework!,
            });
          if (e.type === "TEXT_MESSAGE_CONTENT") {
            const m = live.find((m) => m.id === e.messageId);
            if (m) m.content += e.delta;
          }
        }
        messages = [...messages, ...live];
      }
    }
  }
  async function select(id: string) {
    if (busy) return;
    draftFiles = [];
    notice = "";
    current = { id } as Thread;
    localStorage.setItem("fieldwork-router-thread", id);
    try {
      await refresh();
    } catch (e) {
      notice = (e as Error).message;
      current = null;
    }
  }
  async function start(framework: Framework | null = null) {
    const t = await api("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ framework }),
    });
    current = t;
    messages = [];
    events = [];
    documents = [];
    uploads = [];
    recommendation = null;
    approval = null;
    localStorage.setItem("fieldwork-router-thread", t.id);
    await loadThreads();
    return t;
  }
  function home() {
    if (busy) return;
    current = null;
    refreshVersion++;
    messages = [];
    events = [];
    documents = [];
    uploads = [];
    recommendation = null;
    approval = null;
    draftFiles = [];
    notice = "";
    prompt = "";
    localStorage.removeItem("fieldwork-router-thread");
  }
  async function send(
    text: string,
    handoff?: Framework,
    files: PromptInput.PromptInputAttachmentData[] = [],
  ) {
    if (busy || (!text.trim() && !files.length)) return;
    text = text.trim() || "Please describe the attached files.";
    busy = true;
    notice = "";
    try {
      const t = current || (await start());
      let refs: AttachmentRef[] = [];
      if (files.length) {
        uploading = true;
        draftFiles = files.map((f) => ({
          ...f,
          uploadStatus: "uploading",
          error: undefined,
        }));
        const form = new FormData();
        for (const f of files) form.append("files", f.file, f.filename);
        try {
          const result = await api(`/api/threads/${t.id}/attachments`, {
            method: "POST",
            body: form,
          });
          refs = result.items;
          uploads = [...uploads, ...refs];
          draftFiles = draftFiles.map((f) => ({
            ...f,
            uploadStatus: "uploaded",
          }));
        } catch (e) {
          draftFiles = files.map((f) => ({
            ...f,
            uploadStatus: "error",
            error: (e as Error).message,
          }));
          throw e;
        } finally {
          uploading = false;
        }
      }
      busy = true;
      connected = true;
      prompt = "";
      events = [];
      if (handoff) {
        current = { ...t, phase: "active", framework: handoff };
        recommendation = null;
      }
      messages = [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          agent: "user",
          attachments: refs,
        },
      ];
      const agent = new HttpAgent({
        url: `/api/threads/${t.id}/run`,
        threadId: t.id,
        initialMessages: [
          { id: crypto.randomUUID(), role: "user", content: text },
        ],
      });
      await agent.runAgent(
        {
          forwardedProps: {
            ...(handoff ? { handoff } : {}),
            attachmentIds: refs.map((f) => f.id),
          },
        },
        {
          onEvent: ({ event: e }) => {
            events = [...events, e];
            if (e.type === "RUN_STARTED") draftFiles = [];
            const v = e as any;
            if (e.type === "TEXT_MESSAGE_START")
              messages = [
                ...messages,
                {
                  id: v.messageId,
                  role: "assistant",
                  content: "",
                  agent:
                    current?.phase === "routing"
                      ? "coordinator"
                      : current!.framework!,
                },
              ];
            if (e.type === "TEXT_MESSAGE_CONTENT")
              messages = messages.map((m) =>
                m.id === v.messageId
                  ? { ...m, content: m.content + v.delta }
                  : m,
              );
            if (e.type === "CUSTOM") {
              if (v.name === "route_recommended") recommendation = v.value;
              if (v.name === "approval_requested") approval = v.value;
              if (v.name === "approval_resolved") approval = null;
              if (v.name === "document_saved") void refresh();
            }
            if (e.type === "RUN_ERROR") notice = v.message;
          },
        },
      );
    } catch (e) {
      notice = (e as Error).message;
    } finally {
      connected = false;
      busy = false;
      try {
        await refresh();
        await loadThreads();
      } catch (e) {
        notice = (e as Error).message;
      }
    }
  }
  async function decide(decision: "approved" | "denied") {
    if (!current || !approval) return;
    try {
      await api(`/api/threads/${current.id}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: approval.id, decision }),
      });
      approval = null;
    } catch (e) {
      notice = (e as Error).message;
    }
  }
  async function stop() {
    if (current)
      await api(`/api/threads/${current.id}/cancel`, { method: "POST" });
  }
  onMount(() => {
    if (!data.user) return;
    const savedSidebar = localStorage.getItem("fieldwork-sidebar-collapsed");
    sidebarCollapsed =
      savedSidebar === null
        ? window.matchMedia("(max-width: 680px)").matches
        : savedSidebar === "true";
    void (async () => {
      await loadThreads();
      const id = localStorage.getItem("fieldwork-router-thread");
      if (id && threads.some((t) => t.id === id)) await select(id);
    })();
    const timer = setInterval(() => {
      if (current && !connected) void refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head
  ><title>Fieldwork — find your starting point</title><meta
    name="description"
    content="One workspace. Choose an agent or let Strands help you find a fit."
  /></svelte:head
>
{#snippet brand()}<span class="brand-mark">f.</span><span class="brand-word"
    >fieldwork<span class="brand-period">.</span></span
  >{/snippet}
{#snippet composer(landing = false)}
  <PromptInput.Root
    class={landing ? "task-input landing-input" : "task-input"}
    onSubmit={({ text, attachments }) => send(text, undefined, attachments)}
    bind:attachments={draftFiles}
    accept={UPLOAD_ACCEPT}
    multiple={true}
    maxFiles={MAX_UPLOAD_FILES}
    maxFileSize={MAX_UPLOAD_BYTES}
    clearOnSubmit={false}
    serializeFiles={false}
    disabled={busy}
    onError={(e) => (notice = e.message)}
  >
    <PromptInput.Attachments
      >{#snippet children(file)}<div class="draft-attachment">
          <PromptInput.Attachment data={file} />{#if file.uploadStatus}<small
              class:error={file.uploadStatus === "error"}
              >{file.uploadStatus === "uploading"
                ? "Uploading…"
                : file.uploadStatus === "uploaded"
                  ? "Uploaded"
                  : file.error}</small
            >{/if}
        </div>{/snippet}</PromptInput.Attachments
    >
    <PromptInput.Body
      ><PromptInput.Textarea
        bind:value={prompt}
        placeholder={landing
          ? "Tell us what you want to get done…"
          : current?.phase === "routing"
            ? "Tell Strands a little more…"
            : `Message ${activeName}…`}
        class="task-textarea"
      /></PromptInput.Body
    >
    <PromptInput.Toolbar
      ><AttachFiles disabled={busy} /><span class="input-agent"
        ><Compass size={15} />{landing || current?.phase === "routing"
          ? "Let Strands find a fit"
          : activeName}</span
      ><UsageIndicator {usage} {busy} /><PromptInput.Submit
        status={uploading ? "submitted" : busy ? "streaming" : "ready"}
        disabled={uploading || (!busy && !prompt.trim() && !draftFiles.length)}
        onStop={() => {
          void stop();
        }}
        class="send-button"
      /></PromptInput.Toolbar
    >
  </PromptInput.Root>
{/snippet}
{#if !data.user}
  <div class="identity-screen">
    <header>
      <div class="brand">{@render brand()}</div>
      <span class="eyebrow">MIA EXPERIMENTS / ROUTER LAB</span>
    </header>
    <main class="identity-main">
      <div>
        <p class="eyebrow">A PLACE TO START SOMETHING</p>
        <h1>Good work starts<br />with a little<br /><em>curiosity.</em></h1>
        <p class="intro">
          A thoughtful workspace for your ideas, your questions,<br />and the
          agents that help you move them forward.
        </p>
      </div>
      <section class="person-panel">
        <p class="eyebrow">FIRST, MAKE YOURSELF AT HOME</p>
        <h2>Who’s here today?</h2>
        <form method="POST" action="/auth/person">
          {#each ["mia", "tim"] as person}<button
              name="person"
              value={person}
              class="person-choice"
              ><span class="avatar">{person[0].toUpperCase()}</span><span
                ><strong
                  >{person === "mia" ? "Mia Socci" : "Tim Ritzema"}</strong
                ><small>Your own conversations & files</small></span
              ><ArrowRight size={20} /></button
            >{/each}
        </form>
        <p class="muted small">
          Demo identities for this local experiment. Organizational sign-in
          comes with the cloud deployment.
        </p>
      </section>
    </main>
    <footer>
      Built for curiosity.<span>Local experiment · Svelte AI Elements</span>
    </footer>
  </div>
{:else}
  <div class="workspace">
    <aside
      class="sidebar"
      class:collapsed={sidebarCollapsed}
      aria-label="Conversation sidebar"
    >
      {#if sidebarCollapsed}
        <button
          class="rail-brand"
          aria-label="Expand sidebar"
          aria-expanded="false"
          onclick={() => setSidebarCollapsed(false)}
          ><span class="brand-mark">f.</span></button
        >
        <button
          class="rail-open"
          aria-label="Expand conversation history"
          aria-expanded="false"
          onclick={() => setSidebarCollapsed(false)}
        ></button>
        <a
          class="rail-profile avatar"
          href="/settings"
          aria-label={`Profile and memory settings (${data.user.name})`}
          title="Profile and memory settings">{data.user.name[0]}</a
        >
      {:else}
        <div class="sidebar-heading">
          <button class="brand" onclick={home} disabled={busy}
            >{@render brand()}</button
          >
          <button
            class="collapse-sidebar"
            aria-label="Collapse sidebar"
            aria-expanded="true"
            onclick={() => setSidebarCollapsed(true)}
            ><PanelLeftClose size={18} /></button
          >
        </div>
        <div class="workspace-label eyebrow">
          MIA EXPERIMENTS <span>LAB 02</span>
        </div>
        <Button
          variant="outline"
          class="new-conversation"
          aria-label="New conversation"
          onclick={home}
          disabled={busy}
          ><Plus size={17} /><span>New conversation</span></Button
        >
        <p class="eyebrow history-label">YOUR CONVERSATIONS</p>
        <input
          class="history-search"
          type="search"
          aria-label="Search conversations"
          placeholder="Search conversations…"
          bind:value={historyQuery}
          maxlength="200"
          oninput={() => void filterHistory()}
        />
        <div class="history-filters">
          <button
            class:active={!showArchived}
            onclick={() => {
              showArchived = false;
              void filterHistory();
            }}>Recent</button
          ><button
            class:active={showArchived}
            onclick={() => {
              showArchived = true;
              void filterHistory();
            }}>Archived</button
          >
        </div>
        <nav aria-label="Conversation history">
          {#each threads as t (t.id)}<ConversationRow
              thread={t}
              selected={current?.id === t.id}
              {busy}
              onselect={() => select(t.id)}
              onedit={(patch) => editThread(t.id, patch)}
            />{/each}
          {#if !threads.length}<p class="empty-history">
              {historyQuery
                ? "No matching conversations."
                : showArchived
                  ? "No archived conversations."
                  : "A fresh page. Your next idea starts here."}
            </p>{/if}
        </nav>
        <div class="sidebar-bottom">
          <p class="local-status"><i></i>Local workspace</p>
          <div class="person-footer">
            <a
              class="avatar"
              href="/settings"
              aria-label="Profile and memory settings">{data.user.name[0]}</a
            ><span
              ><strong>{data.user.name}</strong><small
                ><a href="/settings">Profile &amp; memory</a></small
              ></span
            >
            <form action="/auth/logout" method="POST">
              <button aria-label="Switch person"><LogOut size={19} /></button>
            </form>
          </div>
        </div>
      {/if}
    </aside>
    <main class="main-work">
      {#if current}<header class="conversation-toolbar">
          {#key current.id}<ConversationTitle
              title={current.title || "New conversation"}
              onsave={(title) => editThread(current!.id, { title })}
            />{/key}
          <span
            class="run-status"
            class:sr-only={!busy && current.status !== "cancelled"}
            >{busy
              ? "Working"
              : current.status === "cancelled"
                ? "Stopped"
                : "Ready"}</span
          >
          <button
            aria-label="Toggle behind the work"
            aria-expanded={showInspector}
            title={showInspector
              ? "Hide behind the work"
              : "Show behind the work"}
            onclick={() => (showInspector = !showInspector)}
            ><PanelRight size={18} /></button
          >
        </header>{/if}
      {#if !current}<div class="start-page">
          <div class="greeting">
            <span class="eyebrow"
              >HELLO, {data.user.name.split(" ")[0].toUpperCase()}</span
            ><span class="edition"
              ><Sparkles size={16} /> A FRESH START / 001</span
            >
          </div>
          <h1>Bring the task.<br /><em>We’ll find the right agent.</em></h1>
          <p class="intro">
            Pick a framework you know, or tell us what’s on your mind.<br
            />Strands will help you find a starting point.
          </p>
          <div class="section-label">
            <span class="eyebrow">CHOOSE YOUR STARTING POINT</span><span
              >Three frameworks. One workspace.</span
            >
          </div>
          <div class="framework-grid">
            {#each catalog as f, i}<button
                class={`framework-card ${f.color}`}
                disabled={!data.available[f.id]}
                onclick={() => {
                  void start(f.id);
                }}
                ><div class="card-top">
                  <span class="framework-mark">{f.mark}</span><span
                    class="card-number">0{i + 1}</span
                  >
                </div>
                <span class="eyebrow card-tag">{f.tag}</span>
                <h2>{f.name}</h2>
                <p>{f.description}</p>
                <div class="card-bottom">
                  {data.available[f.id]
                    ? "Start here"
                    : "API key needed"}<ArrowUpRight size={19} />
                </div></button
              >{/each}
          </div>
          <div class="or-divider">
            <span></span>
            <p>OR START WITH WHAT YOU NEED</p>
            <span></span>
          </div>
          {@render composer(true)}
          <div class="suggestion-row">
            <Suggestion
              suggestion="Research a topic"
              onclick={() => {
                void send(
                  "I need to research what AG-UI does and get a short report with sources.",
                );
              }}
            /><Suggestion
              suggestion="Plan a project"
              onclick={() => {
                void send(
                  "Help me plan a two-week internal pilot for a shared AI assistant.",
                );
              }}
            /><Suggestion
              suggestion="Think through code"
              onclick={() => {
                void send(
                  "Help me understand and review the design of a TypeScript API.",
                );
              }}
            />
          </div>
          <p class="start-note">
            <GitBranch size={16} />Strands recommends a fit and carries your
            context forward. You choose when to hand off.
          </p>
          {#if notice}<p role="alert" class="notice">{notice}</p>{/if}
        </div>
      {:else}<div class="conversation-layout">
          <section class="chat-panel" aria-label={activeName}>
            <Conversation.Root class="chat-log"
              ><Conversation.Content class="chat-messages"
                >{#if !messages.length}<div class="chat-empty">
                    <Compass size={32} />
                    <h2>What brings you here?</h2>
                    <p>
                      {current.phase === "routing"
                        ? "Tell me what you’d like to accomplish."
                        : "Ask a question, explore an idea, or create something useful."}
                    </p>
                  </div>{/if}{#each messages as m (m.id)}<Message.Root
                    from={m.role}
                    class="chat-message"
                    ><p class="message-label">
                      {m.role === "user"
                        ? "YOU"
                        : m.agent === "coordinator"
                          ? "STRANDS · COORDINATOR"
                          : frameworkName(m.agent as Framework)}
                    </p>
                    <Message.Content
                      >{#if m.attachments?.length}<div class="message-files">
                          {#each m.attachments as f}<a
                              href={f.url}
                              target="_blank"
                              rel="noreferrer"
                              class="message-file"
                              >{#if f.kind === "image"}<img
                                  src={`${f.url}?preview=1`}
                                  alt={f.filename}
                                />{:else}<FileText size={16} />{/if}<span
                                >{f.filename}</span
                              ></a
                            >{/each}
                        </div>{/if}
                      {#if m.role === "assistant"}<Message.Response
                          content={m.content}
                        />
                        {@const sources = citedSources(m.content)}
                        {#if sources.length}<Sources.Root
                            class="research-sources"
                            ><Sources.Trigger count={sources.length}
                              >Cited sources · {sources.length}</Sources.Trigger
                            ><Sources.Content
                              >{#each sources as source}<Sources.Item
                                  href={source.url}
                                  title={source.title}
                                />{/each}</Sources.Content
                            ></Sources.Root
                          >{/if}{:else}<p class="user-text">
                          {m.content}
                        </p>{/if}</Message.Content
                    ></Message.Root
                  >{/each}
                {#if busy}<p class="working-line">
                    <i></i>{approval
                      ? "Waiting for your approval…"
                      : `${activeName} is working…`}
                  </p>{/if}
                {#if recommendation && !busy}<Plan.Root
                    class="recommendation handoff-plan"
                    open={true}
                    ><Plan.Header
                      ><div>
                        <p class="eyebrow">
                          <GitBranch size={15} />SUGGESTED FIT
                        </p>
                        <Plan.Title
                          >{frameworkName(recommendation.framework)}</Plan.Title
                        >
                        <Plan.Description
                          >{recommendation.reason}</Plan.Description
                        >
                      </div>
                      <Plan.Trigger /></Plan.Header
                    >
                    <Plan.Content
                      ><h3 class="eyebrow">WHAT WE’LL HAND OVER</h3>
                      <div class="handoff-brief">
                        <Message.Response content={recommendation.brief} />
                      </div></Plan.Content
                    ><Plan.Footer
                      ><div>
                        <Button
                          onclick={() => {
                            void send(
                              `Start with ${frameworkName(recommendation!.framework)}`,
                              recommendation!.framework,
                            );
                          }}
                          >Start with {catalog.find(
                            (f) => f.id === recommendation!.framework,
                          )?.short}<ArrowRight size={16} /></Button
                        >
                        <div class="alternatives">
                          Or choose {#each catalog.filter((f) => data.available[f.id] && f.id !== recommendation!.framework) as f}<button
                              onclick={() => {
                                void send(`Start with ${f.name}`, f.id);
                              }}>{f.short}</button
                            >{/each}
                        </div>
                      </div></Plan.Footer
                    ></Plan.Root
                  >{/if}
                {#if approval}{#key approval.id}<Confirmation.Root
                      approval={{ id: approval.id }}
                      state="approval-requested"
                      class="approval-card"
                      ><Confirmation.Title
                        >Save {approval.filename}?</Confirmation.Title
                      >
                      <p>{approval.reason}</p>
                      <details>
                        <summary>Review file contents</summary>
                        <pre>{approval.content}</pre>
                      </details>
                      <Confirmation.Actions
                        ><Confirmation.Action onclick={() => decide("approved")}
                          >Approve save</Confirmation.Action
                        ><Confirmation.Action
                          variant="outline"
                          onclick={() => decide("denied")}
                          >Deny</Confirmation.Action
                        ></Confirmation.Actions
                      ><small>This request expires after 90 seconds.</small
                      ></Confirmation.Root
                    >{/key}{/if}
              </Conversation.Content><Conversation.ScrollButton
              /></Conversation.Root
            >
            <div class="composer-bottom">
              {#if notice}<p role="alert" class="notice">
                  {notice}
                </p>{/if}{@render composer()}
              <p>
                {current.phase === "routing"
                  ? "You decide which agent takes it from here."
                  : "Review agent output. Saving a file requires your approval."}
              </p>
            </div>
          </section>
          {#if showInspector}<aside class="inspector">
              <h3>Behind the work <ArrowUpRight size={17} /></h3>
              <div class="inspector-tabs">
                {#each ["Route", "Activity", "Memory", "Files"] as label}<button
                    class:active={tab === label}
                    onclick={() => (tab = label)}
                    >{label}{label === "Files" &&
                    documents.length + uploads.length
                      ? ` (${documents.length + uploads.length})`
                      : ""}</button
                  >{/each}
              </div>
              <div class="inspector-content">
                {#if tab === "Route"}<p class="eyebrow">A LITTLE DIRECTION</p>
                  <ol class="route-steps">
                    <li>
                      <b>01</b>
                      <div>
                        <strong>Bring the task</strong>
                        <p>Your idea, in your own words.</p>
                      </div>
                    </li>
                    <li>
                      <b>02</b>
                      <div>
                        <strong
                          >{current.phase === "routing"
                            ? "Find a fit"
                            : "Framework chosen"}</strong
                        >
                        <p>
                          {current.phase === "routing"
                            ? "Strands considers the tools each agent has."
                            : activeName}
                        </p>
                      </div>
                    </li>
                    <li class:muted={current.phase === "routing"}>
                      <b>03</b>
                      <div>
                        <strong>Get to work</strong>
                        <p>Keep the conversation and its files together.</p>
                      </div>
                    </li>
                  </ol>
                  <div class="inspector-note">
                    A recommendation is based on this workspace’s configured
                    capabilities, not a universal ranking of models.
                  </div>{:else if tab === "Activity"}<p class="eyebrow">
                    TOOLS & EVENTS
                  </p>
                  {#each tools as tool (tool.id)}<Tool.Root
                      class="activity-tool"
                      ><Tool.Header
                        type={tool.name.replaceAll("_", " ")}
                        state={tool.state}
                      /><Tool.Content
                        ><Tool.Input input={tool.input} /><Tool.Output
                          output={tool.output}
                          errorText={tool.error}
                        /></Tool.Content
                      ></Tool.Root
                    >{/each}
                  {#if !tools.length}<p class="muted">
                      Tool activity appears here when the agent uses a tool.
                    </p>{/if}
                  <details class="event-log">
                    <summary>AG-UI events · {events.length}</summary
                    >{#each events as e}<div>
                        {e.type}{e.name ? ` / ${e.name}` : ""}
                      </div>{/each}
                  </details>{:else if tab === "Memory"}
                  <p class="eyebrow">RECALLED FOR THIS RUN</p>
                  {@const recall = events.findLast(
                    (e) => e.type === "CUSTOM" && e.name === "memory_recalled",
                  )?.value}
                  <p class="muted">
                    {recall?.status ||
                      "Memory activity appears when you send a message."}
                  </p>
                  {#each recall?.items || [] as memory}<div
                      class="memory-recall"
                    >
                      <small>{memory.framework} · {memory.kind}</small>
                      <p>{memory.text}</p>
                    </div>{/each}
                  <a class="memory-settings-link" href="/settings"
                    >Profile &amp; memory settings →</a
                  >
                  <p class="muted">
                    This shows context supplied to this run. Changing settings
                    affects future requests.
                  </p>
                {:else}<p class="eyebrow">CONVERSATION FILES</p>
                  {#if uploads.length}<p class="eyebrow upload-section-label">
                      UPLOADED FILES
                    </p>
                    {#each uploads as file}<div class="document-card">
                        <FileText size={18} /><span>{file.filename}</span><a
                          href={file.url}
                          aria-label={`Download ${file.filename}`}
                          ><Download size={17} /></a
                        >
                      </div>{/each}
                    <p class="eyebrow upload-section-label">
                      GENERATED FILES
                    </p>{/if}
                  {#each documents as doc}<div class="document-card">
                      <FileText size={18} /><span>{doc.filename}</span><a
                        href={doc.url}
                        aria-label={`Download ${doc.filename}`}
                        ><Download size={17} /></a
                      >{#if doc.filename.endsWith(".html")}<button
                          onclick={() => (preview = doc)}>Preview</button
                        >{/if}
                    </div>{/each}{#if !documents.length}<p class="muted">
                      Ask your agent to save a report, an HTML infographic, or a
                      PDF. Approved files appear here.
                    </p>{/if}{/if}
              </div>
              <div class="inspector-footer">
                <ShieldCheck size={18} /><span
                  >Files belong to this conversation.<br />Generated files need
                  your approval.</span
                >
              </div>
            </aside>{/if}
        </div>{/if}
    </main>
  </div>
{/if}
{#if preview}<dialog
    class="preview-dialog"
    use:showDialog
    onclose={() => (preview = null)}
  >
    <header>
      <strong>{preview.filename}</strong><a href={preview.url}>Download</a
      ><button onclick={() => (preview = null)}>Close</button>
    </header>
    <iframe
      title={preview.filename}
      src={`${preview.url}?preview=1`}
      sandbox=""
      referrerpolicy="no-referrer"
    ></iframe>
  </dialog>{/if}
