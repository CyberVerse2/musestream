// A house agent's thinking: one OpenAI call that looks at the stream and picks what to do,
// as function calls. Nothing is sent back to the model; the next call gets a fresh look.
const RESPONSES = 'https://api.openai.com/v1/responses';

export interface BrainTool {
	name: string;
	description: string;
	/** JSON schema of the arguments, in OpenAI's strict form */
	parameters: Record<string, unknown>;
}

export interface BrainCall {
	name: string;
	args: Record<string, unknown>;
}

export class Brain {
	private apiKey: string;
	private model: string;

	constructor(apiKey: string, model: string) {
		this.apiKey = apiKey;
		this.model = model;
	}

	/** the actions the model chose, in order; none when it chose to do nothing */
	async decide(instructions: string, input: string, tools: BrainTool[]): Promise<BrainCall[]> {
		const res = await fetch(RESPONSES, {
			method: 'POST',
			headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.model,
				reasoning: { effort: 'low' },
				store: false,
				instructions,
				input,
				tools: tools.map((t) => ({ type: 'function', strict: true, ...t })),
				parallel_tool_calls: true
			}),
			signal: AbortSignal.timeout(45_000)
		});
		const body = (await res.json().catch(() => null)) as {
			error?: { message?: string };
			output?: { type: string; name?: string; arguments?: string }[];
		} | null;
		if (!res.ok || !body)
			throw new Error(body?.error?.message ?? `The brain call failed (${res.status})`);
		return (body.output ?? []).flatMap((item) => {
			if (item.type !== 'function_call' || !item.name) return [];
			try {
				return [{ name: item.name, args: JSON.parse(item.arguments ?? '{}') }];
			} catch {
				return [];
			}
		});
	}
}
