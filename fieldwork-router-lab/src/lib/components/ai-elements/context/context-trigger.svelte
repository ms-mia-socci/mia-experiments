<script lang="ts">
	import { Button, type ButtonProps } from "$lib/components/ui/button";
	import HoverCardTrigger from "$lib/components/ui/hover-card/hover-card-trigger.svelte";
	import ContextIcon from "./context-icon.svelte";
	import { getContextValue } from "./context-context.svelte.js";

	interface Props {
		children?: import("svelte").Snippet;
		[key: string]: any;
	}

	let { children, ...props }: Props = $props();

	const context = getContextValue();
</script>

<HoverCardTrigger {...props}>
{#snippet child({props:triggerProps})}<button type="button" {...triggerProps}>{#if children}{@render children()}{:else}<span>{context.displayPercent}</span><ContextIcon/>{/if}</button>{/snippet}
</HoverCardTrigger>
