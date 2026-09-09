<script lang="ts">
  import "./layout.css";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import favicon from "$lib/assets/favicon.svg";

  let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<Tooltip.Provider>{@render children()}</Tooltip.Provider>
