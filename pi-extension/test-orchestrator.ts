import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_PATH = join(__dirname, "test-worker.ts");

// ── JSONL Worker Spawner ─────────────────────────────────────────────────────
// Spawns a headless Pi child with a single custom tool.
// Returns the structured JSON args the LLM passed to that tool.

interface WorkerOpts {
	systemPrompt: string;
	toolName: string;
	toolDesc: string;
	schema: Record<string, unknown>;
	prompt: string;
}

function spawnWorker(opts: WorkerOpts): Promise<Record<string, any>> {
	return new Promise((resolve, reject) => {
		const proc = spawn(
			"pi",
			[
				"-p",
				"--mode",
				"json",
				"--no-extensions",
				"-e",
				WORKER_PATH,
				"--no-session",
				"--no-tools",
				"--thinking",
				"off",
				opts.prompt,
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					WORKER_SYSTEM_PROMPT: opts.systemPrompt,
					WORKER_TOOL_NAME: opts.toolName,
					WORKER_TOOL_DESC: opts.toolDesc,
					WORKER_SCHEMA: JSON.stringify(opts.schema),
				},
			},
		);

		let toolArgs: any = null;
		let buffer = "";
		let stderrText = "";

		proc.stdout!.setEncoding("utf-8");
		proc.stdout!.on("data", (chunk: string) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (
						event.type === "tool_execution_start" &&
						event.toolName === opts.toolName
					) {
						toolArgs = event.args;
					}
				} catch {}
			}
		});

		proc.stderr!.setEncoding("utf-8");
		proc.stderr!.on("data", (chunk: string) => {
			stderrText += chunk;
		});

		proc.on("close", (code) => {
			if (buffer.trim()) {
				try {
					const event = JSON.parse(buffer);
					if (
						event.type === "tool_execution_start" &&
						event.toolName === opts.toolName
					) {
						toolArgs = event.args;
					}
				} catch {}
			}

			if (toolArgs) {
				resolve(toolArgs);
			} else {
				reject(
					new Error(
						`Worker "${opts.toolName}" exited code ${code}. Stderr: ${stderrText.slice(0, 500)}`,
					),
				);
			}
		});

		proc.on("error", (err) => reject(err));
	});
}

// ── Graph Machine ────────────────────────────────────────────────────────────

async function runGraphMachine(input: string, ctx: ExtensionContext, pi: ExtensionAPI) {
	const startTime = Date.now();

	// ── Node 1: Classifier ───────────────────────────────────────────────────
	ctx.ui.setWorkingMessage("Node 1: Classifier agent thinking...");

	const classification = await spawnWorker({
		systemPrompt: [
			"You are a request classifier.",
			"Classify the user's request into exactly one category:",
			"- 'technical' = bugs, code, systems, infrastructure, debugging",
			"- 'creative' = writing, art, design, storytelling, poetry",
			"Be decisive. Pick the best fit.",
		].join("\n"),
		toolName: "submit_classification",
		toolDesc: "Submit your classification of the request.",
		schema: {
			type: "object",
			properties: {
				category: {
					type: "string",
					enum: ["technical", "creative"],
					description: "The category this request belongs to.",
				},
				reasoning: {
					type: "string",
					description: "One sentence explaining your classification.",
				},
			},
			required: ["category", "reasoning"],
		},
		prompt: `Classify this request: "${input}"`,
	});

	const route = classification.category as "technical" | "creative";

	// ── Deterministic Edge: TypeScript routes based on classification ─────────
	ctx.ui.notify(
		`Classifier: "${route}" — ${classification.reasoning}`,
		"info",
	);

	let finalResult: Record<string, any>;

	if (route === "technical") {
		// ── Node 2a: Technical Analyst ──────────────────────────────────────────
		ctx.ui.setWorkingMessage("Node 2a: Technical Analyst agent thinking...");

		finalResult = await spawnWorker({
			systemPrompt: [
				"You are a senior technical analyst.",
				"Given a technical request, produce a brief analysis.",
				"Be specific and actionable.",
			].join("\n"),
			toolName: "submit_analysis",
			toolDesc: "Submit your technical analysis.",
			schema: {
				type: "object",
				properties: {
					diagnosis: {
						type: "string",
						description: "What is the core technical issue?",
					},
					approach: {
						type: "string",
						description: "Recommended approach to solve it.",
					},
					risk_level: {
						type: "string",
						enum: ["low", "medium", "high"],
						description: "Risk level of the fix.",
					},
				},
				required: ["diagnosis", "approach", "risk_level"],
			},
			prompt: `Analyze this technical request: "${input}"`,
		});
	} else {
		// ── Node 2b: Creative Writer ───────────────────────────────────────────
		ctx.ui.setWorkingMessage("Node 2b: Creative Writer agent thinking...");

		finalResult = await spawnWorker({
			systemPrompt: [
				"You are a creative writer.",
				"Given a creative request, produce the requested piece.",
				"Be concise but evocative.",
			].join("\n"),
			toolName: "submit_draft",
			toolDesc: "Submit your creative piece.",
			schema: {
				type: "object",
				properties: {
					piece: {
						type: "string",
						description: "The creative writing you produced.",
					},
					style: {
						type: "string",
						description: "The style or form you used.",
					},
				},
				required: ["piece", "style"],
			},
			prompt: `Fulfill this creative request: "${input}"`,
		});
	}

	ctx.ui.setWorkingMessage();
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

	// ── Display results ──────────────────────────────────────────────────────
	const separator = "─".repeat(60);
	const lines = [
		`${separator}`,
		`GRAPH MACHINE RESULT (${elapsed}s)`,
		`${separator}`,
		`Input:    "${input}"`,
		`Route:    ${route.toUpperCase()} (${classification.reasoning})`,
		`${separator}`,
	];

	if (route === "technical") {
		lines.push(
			`Diagnosis:  ${finalResult.diagnosis}`,
			`Approach:   ${finalResult.approach}`,
			`Risk:       ${finalResult.risk_level}`,
		);
	} else {
		lines.push(
			`Style:  ${finalResult.style}`,
			``,
			finalResult.piece,
		);
	}

	lines.push(separator);

	pi.sendMessage(
		{
			customType: "graph-result",
			content: lines.join("\n"),
			display: true,
		},
		{ triggerTurn: false },
	);

	ctx.ui.notify(`Graph machine complete in ${elapsed}s — route: ${route}`, "success");
}

// ── Extension Entry Point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerCommand("test-route", {
		description:
			"Test graph machine routing. Usage: /test-route <your request>",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify(
					"Usage: /test-route <your request>",
					"warning",
				);
				return;
			}
			try {
				await runGraphMachine(args.trim(), ctx, pi);
			} catch (err: any) {
				ctx.ui.notify(`Graph Machine Error: ${err.message}`, "error");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.notify(
			"Graph machine loaded. Try: /test-route Fix the memory leak  OR  /test-route Write a haiku about rain",
			"info",
		);
	});
}
