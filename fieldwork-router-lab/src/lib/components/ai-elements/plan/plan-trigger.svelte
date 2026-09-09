<script lang="ts">
	import { CollapsibleTrigger } from "$lib/components/ui/collapsible/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { cn } from "$lib/utils";
	import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
	import type { PlanTriggerProps } from "./types.js";

	let { class: className, children, ...restProps }: PlanTriggerProps = $props();
</script>

<CollapsibleTrigger class={cn("size-8 inline-flex items-center justify-center rounded-md", className)} aria-label="Toggle plan" {...restProps}>
{#if children}{@render children()}{:else}<ChevronsUpDownIcon class="size-4" />{/if}
</CollapsibleTrigger>
