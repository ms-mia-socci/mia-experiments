<script lang="ts">
	import * as HoverCard from "$lib/components/ui/hover-card/index.js";
	import { ContextClass, setContextValue, type ContextSchema } from "./context-context.svelte.js";
	import { untrack } from "svelte";

	interface Props extends ContextSchema {
		children?: import("svelte").Snippet;
		// HoverCard props
		closeDelay?: number;
		openDelay?: number;
		[key: string]: any;
	}
	// indexing
	let {
		open = $bindable(false),
		usedTokens,
		maxTokens,
		usage,
		modelId,
		children,
		closeDelay = 0,
		openDelay = 0,
		...props
	}: Props = $props();

	const contextInstance = new ContextClass({
		usedTokens: untrack(() => usedTokens),
		maxTokens: untrack(() => maxTokens),
		usage: untrack(() => usage),
		modelId: untrack(() => modelId),
	});

	// Update context when props change
	$effect(() => {
		contextInstance.usedTokens = usedTokens;
		contextInstance.maxTokens = maxTokens;
		contextInstance.usage = usage;
		contextInstance.modelId = modelId;
	});

	setContextValue(contextInstance);
</script>

<HoverCard.Root bind:open {openDelay} {closeDelay} {...props}>
	{@render children?.()}
</HoverCard.Root>
