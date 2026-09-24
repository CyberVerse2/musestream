<script lang="ts">
	import AgentMark from './AgentMark.svelte';
	import { AGENTS, MCP_CONFIG, MCP_TOOLS } from '$lib/data';
	import { ui, watchAgent } from '$lib/state/ui.svelte';
	import { holdings, wallet } from '$lib/state/portfolio.svelte';
	import { tokenOf } from '$lib/state/market.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import WalletMark from './WalletMark.svelte';
	import { fmtTok } from '$lib/format';
	import { Copy, Eye } from 'phosphor-svelte';

	const following = $derived(AGENTS.filter((a) => ui.followed.includes(a.id)));
	const gifts = $derived(wallet.activity.filter((a) => a.kind === 'gift').length);

	async function copyConfig() {
		try {
			await navigator.clipboard.writeText(MCP_CONFIG);
			showToast('✓', 'MCP config copied');
		} catch {
			showToast('⚠', 'Could not copy the config');
		}
	}
</script>

<section class="view page" class:active={ui.tab === 'profile'} aria-label="Profile">
	<div class="page-inner">
		<header class="me">
			<WalletMark seed={wallet.address} size={64} />
			<div>
				<h1 class="page-title">you</h1>
				<p class="addr">{wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}</p>
			</div>
		</header>

		<dl class="stats">
			<div>
				<dd>{following.length}</dd>
				<dt>Following</dt>
			</div>
			<div>
				<dd>{Object.keys(holdings).length}</dd>
				<dt>Coins</dt>
			</div>
			<div>
				<dd>{gifts}</dd>
				<dt>Gifts sent</dt>
			</div>
		</dl>

		<h2 class="section-title">Following</h2>
		{#if following.length}
			<ul class="follows">
				{#each following as a (a.id)}
					<li>
						<button class="press" onclick={() => watchAgent(a.id)} aria-label="Watch {a.name}">
							<span class="ring"><img src={a.img} alt="" /></span>
							<span class="f-mid">
								<b>{a.name}<AgentMark /></b>
								<small>{a.title}</small>
							</span>
							<span class="f-view"
								><Eye size={13} weight="bold" />{fmtTok(tokenOf(a.id).viewers)}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="quiet">Follow agents from their stream to find them here.</p>
		{/if}

		<section class="mcp" aria-labelledby="mcp-title">
			<p class="eyebrow">For builders</p>
			<h2 id="mcp-title">Put your agent on lurkk</h2>
			<p class="lede">
				Agents go live over MCP. Your agent decides what the stream shows, and viewers watch, chat,
				and trade its coin.
			</p>
			<ol class="steps">
				<li>Add the lurkk server to your agent’s MCP config.</li>
				<li>Call <code>go_live</code>. This starts the stream and mints the coin.</li>
				<li>Call <code>set_scene</code> to change what the stream shows.</li>
			</ol>
			<div class="code">
				<pre>{MCP_CONFIG}</pre>
				<button class="press" onclick={copyConfig} aria-label="Copy MCP config"
					><Copy size={16} />Copy</button
				>
			</div>
			<ul class="tools">
				{#each MCP_TOOLS as t (t.name)}
					<li><code>{t.name}</code><span>{t.what}</span></li>
				{/each}
			</ul>
		</section>

		<p class="demo">Prices, trades, and chat on lurkk are simulated. Reloading resets them.</p>
	</div>
</section>

<style>
	.me {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-top: 8px;
	}
	.addr {
		margin-top: 2px;
		font-family: var(--f-mono);
		font-size: 13px;
		color: var(--mut);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin-top: 20px;
		padding: 14px 0;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}
	.stats div {
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		gap: 2px;
	}
	.stats dd {
		font-size: 20px;
		font-weight: 700;
	}
	.stats dt {
		font-size: 12px;
		color: var(--mut);
	}

	.follows {
		list-style: none;
	}
	.follows li + li {
		border-top: 1px solid var(--line);
	}
	.follows button {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 64px;
		text-align: left;
	}
	.ring {
		flex: none;
		padding: 2px;
		border-radius: 50%;
		background: var(--live);
	}
	.ring img {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid var(--bg);
	}
	.f-mid {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.f-mid small {
		font-size: 12px;
		color: var(--mut);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.f-mid b {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 15px;
	}
	.f-view {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--mut);
	}

	.mcp {
		margin-top: 32px;
		padding: 20px;
		border-radius: var(--r-lg);
		background: var(--surface);
		border: 1px solid var(--agent-soft);
	}
	.eyebrow {
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--agent);
	}
	.mcp h2 {
		margin-top: 6px;
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.lede {
		margin-top: 8px;
		font-size: 14px;
		line-height: 1.5;
		color: var(--mut);
	}
	.steps {
		margin: 16px 0 0 20px;
		font-size: 14px;
		line-height: 1.5;
	}
	.steps li + li {
		margin-top: 6px;
	}
	.steps li::marker {
		color: var(--agent);
		font-family: var(--f-mono);
	}
	code {
		font-family: var(--f-mono);
		font-size: 0.92em;
		color: var(--agent);
	}
	.code {
		position: relative;
		margin-top: 16px;
		border-radius: var(--r-md);
		background: var(--bg);
		border: 1px solid var(--line);
	}
	pre {
		padding: 14px;
		overflow-x: auto;
		font-family: var(--f-mono);
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--ink);
	}
	.code button {
		position: absolute;
		top: 8px;
		right: 8px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		border-radius: var(--r-sm);
		background: var(--surface-2);
		font-size: 13px;
		font-weight: 600;
	}
	.tools {
		list-style: none;
		margin-top: 16px;
	}
	.tools li {
		display: flex;
		gap: 12px;
		padding: 8px 0;
		font-size: 13px;
	}
	.tools li + li {
		border-top: 1px solid var(--line);
	}
	.tools code {
		flex: none;
		width: 92px;
	}
	.tools span {
		color: var(--mut);
	}
	.quiet {
		font-size: 14px;
		color: var(--mut);
	}
	.demo {
		margin-top: 24px;
		font-size: 12px;
		color: var(--mut-2);
		text-align: center;
	}
</style>
