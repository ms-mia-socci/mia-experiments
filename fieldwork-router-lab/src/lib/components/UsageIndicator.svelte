<script lang="ts">
  import * as Context from "$lib/components/ai-elements/context";
  import { ChartPie } from "@lucide/svelte";
  import type { UsageSnapshot } from "$lib/usage";
  import { frameworkName } from "$lib/catalog";
  let { usage, busy = false }: { usage: UsageSnapshot | null; busy?: boolean } =
    $props();
  let open = $state(false);
  const compact = (v: number) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  const number = (v: number | null) =>
    v === null ? "Not reported" : v.toLocaleString("en-US");
  const percent = $derived(
    usage?.context?.limit
      ? (usage.context.input / usage.context.limit) * 100
      : null,
  );
</script>

<Context.Root
  usedTokens={usage?.context?.input ?? 0}
  maxTokens={usage?.context?.limit ?? 0}
  bind:open
>
  <Context.Trigger
    class="usage-trigger"
    aria-label="Context and token usage"
    onclick={() => (open = true)}
    onkeydown={(e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    }}
    ><ChartPie size={14} />{#if usage?.context}{compact(usage.context.input)} input{#if percent !== null}
        · {percent.toFixed(1)}%{/if}{:else if usage}{compact(
        usage.totals.input + usage.totals.output,
      )} run tokens{:else}Usage{busy ? " pending" : ""}{/if}</Context.Trigger
  >
  <Context.Content class="usage-popover" align="end" side="top">
    <Context.ContentHeader
      ><div class="usage-title">Context & tokens</div>
      <p class="usage-caption">
        {usage ? frameworkName(usage.framework) : "This run"}{usage?.model
          ? ` · ${usage.model}`
          : ""}
      </p></Context.ContentHeader
    >
    <Context.ContentBody>
      {#if usage}
        <div class="usage-section">
          <h4>Last model input</h4>
          {#if usage.context}<strong
              >{number(usage.context.input)} tokens</strong
            >{#if percent !== null}<p>
                {percent.toFixed(1)}% of the reported {number(
                  usage.context.limit,
                )}-token window
              </p>
              <progress
                max="100"
                value={Math.min(100, percent)}
                aria-label="Last model input as share of context window"
              ></progress>{:else}<p>
                Window limit not reported; percentage unavailable.
              </p>{/if}
            <p>
              Input processed by the last model request, including cached
              tokens. This is a snapshot, not a live count of the next prompt.
            </p>{:else}<p>
              The SDK reports turn totals, not the current context size.
            </p>{/if}
        </div>
        <div class="usage-section">
          <h4>
            {usage.scope === "run-total" ? "Run totals" : "Reported so far"}
          </h4>
          <dl>
            <div>
              <dt>Input (includes cache)</dt>
              <dd>{number(usage.totals.input)}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>{number(usage.totals.output)}</dd>
            </div>
            <div>
              <dt>Cache read</dt>
              <dd>{number(usage.totals.cacheRead)}</dd>
            </div>
            <div>
              <dt>Cache write</dt>
              <dd>{number(usage.totals.cacheWrite)}</dd>
            </div>
            <div>
              <dt>Reasoning (within output)</dt>
              <dd>{number(usage.totals.reasoning)}</dd>
            </div>
            {#if usage.costUsd !== null}<div>
                <dt>SDK estimated cost</dt>
                <dd>${usage.costUsd.toFixed(4)}</dd>
              </div>{/if}
          </dl>
          <p>
            Repeated model calls can count the same context more than once.
            Cache and reasoning counts are subsets, not extra tokens.
          </p>
        </div>
      {:else}<p class="usage-empty">
          {busy
            ? "Waiting for the SDK to report token usage."
            : "No token metrics were recorded for this run. Send a new message to see usage."}
        </p>{/if}
    </Context.ContentBody>
  </Context.Content>
</Context.Root>
