<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Paperclip } from "@lucide/svelte";
  import { getAttachmentsContext } from "$lib/components/ai-elements/prompt-input";
  let { disabled = false }: { disabled?: boolean } = $props();
  const attachments = getAttachmentsContext();
</script>

<Button
  type="button"
  variant="ghost"
  size="icon"
  class="attach-button"
  aria-label="Attach files"
  title="Images, PDFs, or text · Up to 5 files, 5 MB each"
  {disabled}
  onclick={() => attachments.openFileDialog()}><Paperclip size={16} /></Button
>
