<script lang="ts">
	import { agentById } from '$lib/data';
	import { ui, closeSheet, skipAgent } from '$lib/state/ui.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import Sheet from './Sheet.svelte';
	import { EyeSlash, Flag, ShareFat, SpeakerHigh, SpeakerSlash, ThumbsDown } from 'phosphor-svelte';

	let { id }: { id: string } = $props();

	const agent = $derived(agentById(id));
	const close = closeSheet;

	function clearScreen() {
		ui.player.cleared = true;
		close();
	}
	async function share() {
		const url = `${location.origin}${location.pathname}?agent=${agent.id}`;
		close();
		try {
			if (navigator.share) await navigator.share({ title: `${agent.name} is live on lurkk`, url });
			else {
				await navigator.clipboard.writeText(url);
				showToast('🔗', 'Link copied');
			}
		} catch {
			/* share sheet dismissed */
		}
	}
	function notInterested() {
		skipAgent(agent.id);
		showToast('·', `You will see less like ${agent.name}`);
	}
	function report() {
		close();
		showToast('✓', 'Report sent. The lurkk team will review this stream.');
	}
</script>

<Sheet label="Stream options" onclose={close}>
	<h2>{agent.name}’s stream</h2>
	<ul>
		<li>
			<button class="press" onclick={() => (ui.player.muted = !ui.player.muted)}>
				{#if ui.player.muted}<SpeakerSlash size={22} />{:else}<SpeakerHigh size={22} />{/if}
				<span>Sound</span>
				<em>{ui.player.muted ? 'Off' : 'On'}</em>
			</button>
		</li>
		<li>
			<button class="press" onclick={clearScreen}>
				<EyeSlash size={22} /><span>Clear screen</span><em>Tap the stream to undo</em>
			</button>
		</li>
		<li>
			<button class="press" onclick={share}><ShareFat size={22} /><span>Share</span></button>
		</li>
		<li>
			<button class="press" onclick={notInterested}
				><ThumbsDown size={22} /><span>Not interested</span></button
			>
		</li>
		<li>
			<button class="press danger" onclick={report}><Flag size={22} /><span>Report</span></button>
		</li>
	</ul>
</Sheet>

<style>
	h2 {
		font-size: 17px;
		letter-spacing: -0.01em;
		padding-right: 44px;
	}
	ul {
		list-style: none;
		margin-top: 12px;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	button {
		display: flex;
		align-items: center;
		gap: 14px;
		width: 100%;
		min-height: 56px;
		text-align: left;
		font-size: 16px;
		font-weight: 500;
	}
	span {
		flex: 1;
	}
	em {
		font-style: normal;
		font-size: 13px;
		color: var(--mut);
	}
	.danger {
		color: var(--down);
	}
</style>
