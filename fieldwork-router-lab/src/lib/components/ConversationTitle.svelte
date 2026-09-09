<script lang="ts">
  import { Pencil, Check, X } from "@lucide/svelte";
  import { tick } from "svelte";
  let {
    title,
    onsave,
  }: { title: string; onsave: (title: string) => Promise<void> } = $props();
  let editing = $state(false),
    draft = $state(""),
    saving = $state(false);
  let trigger = $state<HTMLButtonElement>();
  function focusInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
  async function close() {
    editing = false;
    await tick();
    trigger?.focus();
  }
  async function save() {
    if (saving || !draft.trim()) return;
    saving = true;
    try {
      await onsave(draft.trim());
      await close();
    } catch {
      /* Parent shows the error; keep the draft for retry. */
    } finally {
      saving = false;
    }
  }
</script>

{#if editing}<form
    class="thread-title-editor"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <input
      aria-label="Thread title"
      bind:value={draft}
      maxlength="80"
      required
      disabled={saving}
      use:focusInput
      onkeydown={(e) => {
        if (e.key === "Escape" && !saving) {
          e.preventDefault();
          void close();
        }
      }}
    />
    <button
      type="submit"
      aria-label="Save thread title"
      disabled={saving || !draft.trim()}
      title="Save title"><Check size={17} /></button
    >
    <button
      type="button"
      aria-label="Cancel title edit"
      disabled={saving}
      title="Cancel"
      onclick={close}><X size={17} /></button
    >
  </form>{:else}<h1 class="thread-title-heading">
    <button
      bind:this={trigger}
      class="thread-title-button"
      aria-label={`Rename thread: ${title}`}
      title="Rename thread"
      onclick={() => {
        draft = title;
        editing = true;
      }}><span>{title}</span><Pencil size={14} /></button
    >
  </h1>{/if}
