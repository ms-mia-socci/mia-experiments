<script lang="ts">
  import {
    MoreHorizontal,
    Pin,
    Archive,
    ArchiveRestore,
    Pencil,
  } from "@lucide/svelte";
  import { frameworkName, type Framework } from "$lib/catalog";
  let {
    thread,
    selected,
    busy,
    onselect,
    onedit,
  }: {
    thread: {
      id: string;
      title: string;
      framework: Framework | null;
      phase: string;
      pinned?: boolean;
      archived?: boolean;
    };
    selected: boolean;
    busy: boolean;
    onselect: () => void;
    onedit: (patch: {
      title?: string;
      pinned?: boolean;
      archived?: boolean;
    }) => Promise<void>;
  } = $props();
  let open = $state(false),
    renaming = $state(false),
    title = $state(""),
    saving = $state(false);
  async function edit(patch: {
    title?: string;
    pinned?: boolean;
    archived?: boolean;
  }) {
    saving = true;
    try {
      await onedit(patch);
      open = false;
      renaming = false;
    } catch {
      /* Parent displays the error; retain the editor for retry. */
    } finally {
      saving = false;
    }
  }
</script>

<div class="history-row" class:selected>
  {#if renaming}<form
      class="rename-thread"
      onsubmit={(e) => {
        e.preventDefault();
        void edit({ title: title.trim() });
      }}
    >
      <input
        aria-label="Conversation title"
        bind:value={title}
        maxlength="80"
        required
      />
      <div>
        <button disabled={saving || !title.trim()} type="submit">Save</button
        ><button type="button" onclick={() => (renaming = false)}>Cancel</button
        >
      </div>
    </form>
  {:else}<div class="history-row-main">
      <button
        class="thread-link"
        class:selected
        onclick={onselect}
        disabled={busy}
        title={thread.title}
        ><span class="thread-dot"
          >{thread.pinned
            ? "⌖"
            : thread.framework === "claude"
              ? "✳"
              : thread.framework === "codex"
                ? "›"
                : "○"}</span
        ><span
          ><strong>{thread.title}</strong><small
            >{thread.phase === "routing"
              ? "Finding a fit"
              : frameworkName(thread.framework!)}</small
          ></span
        ></button
      ><button
        class="thread-options"
        aria-label={`Options for ${thread.title}`}
        aria-expanded={open}
        disabled={saving}
        onclick={() => (open = !open)}><MoreHorizontal size={16} /></button
      >
    </div>
    {#if open}<div class="thread-actions">
        <button
          onclick={() => {
            title = thread.title;
            renaming = true;
          }}><Pencil size={13} />Rename</button
        ><button
          disabled={saving}
          onclick={() => edit({ pinned: !thread.pinned })}
          ><Pin size={13} />{thread.pinned ? "Unpin" : "Pin"}</button
        ><button
          disabled={busy || saving}
          onclick={() => edit({ archived: !thread.archived })}
          >{#if thread.archived}<ArchiveRestore size={13} />{:else}<Archive
              size={13}
            />{/if}{thread.archived ? "Restore" : "Archive"}</button
        >
      </div>{/if}{/if}
</div>
