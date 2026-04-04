import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { parse as parseYaml } from "yaml";
import { existsSync, readFileSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Phase 1: Types ──────────────────────────────────────────────────────────

/** A single node in the graph — represents one LLM worker. */
export interface NodeDef {
	persona: string;       // Path to persona .md file (relative to baseDir)
	schema: string;        // Path to schema .json file (relative to baseDir)
	tools?: string;        // Comma-separated tool list (e.g. "read,bash,grep")
	prompt: string;        // Prompt template with {{variable}} interpolation
	model?: string;        // Optional model override (inherits parent if omitted)
}

/** An edge connecting two points in the graph. */
export interface EdgeDef {
	from: string;          // Source: "START" | node name | loop name
	to: string;            // Target: node name | loop name | "HUMAN_GATE" | "DONE"
}

/** A loop definition — either `until` or `for_each`, not both. */
export interface LoopDef {
	nodes: string[];       // Ordered list of node names to execute per cycle
	until?: string;        // Condition string: "node.output.field === 'value'"
	for_each?: string;     // Dot-path to array: "node.output.field"
	max_cycles: number;    // Upper bound on iterations
	on_max?: string;       // What to do when max_cycles exceeded (e.g. "BLOCKED")
	pass_context?: string[]; // Variables to carry between cycles
}

/** A human gate — pauses execution for human decision. */
export interface HumanGateDef {
	after: string;         // Node or loop name that precedes this gate
	title: string;         // Display title
	display: string[];     // Template strings to show (e.g. "{{reviewer.output.bottom_line}}")
	options: HumanGateOption[];
}

export interface HumanGateOption {
	label: string;         // Button label shown to user
	routes_to: string;     // Where to go: node name | "DONE" | "BLOCKED"
}

/** Top-level graph definition parsed from YAML. */
export interface GraphDef {
	name: string;
	description: string;
	nodes: Record<string, NodeDef>;
	edges: EdgeDef[];
	loops?: Record<string, LoopDef>;
	human_gates?: HumanGateDef[];
}

/** Runtime state of a single node. */
export interface NodeState {
	status: "idle" | "running" | "done" | "error";
	output?: Record<string, any>;
	error?: string;
	startedAt?: number;
	completedAt?: number;
}

/** Runtime state of the entire graph execution. */
export interface GraphState {
	graphName: string;
	status: "running" | "completed" | "blocked" | "error";
	currentNode: string | null;
	currentLoop: string | null;
	loopCycles: Record<string, number>;  // loop name -> current cycle
	nodeStates: Record<string, NodeState>;
	outputs: Record<string, Record<string, any>>;  // node name -> output
	input: string;                        // Original user input
	startedAt: number;
	completedAt?: number;
}

/** Result of graph validation. */
export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

// ── Phase 1: YAML Parser ────────────────────────────────────────────────────

/**
 * Parse a YAML string into a typed GraphDef.
 * Wraps yaml.parse() in try/catch per plan-review issue #5.
 */
export function parseGraph(yamlString: string): GraphDef {
	let raw: any;
	try {
		raw = parseYaml(yamlString);
	} catch (err: any) {
		throw new Error(`YAML syntax error: ${err.message}`);
	}

	if (!raw || typeof raw !== "object") {
		throw new Error("YAML did not parse into an object");
	}

	const graph: GraphDef = {
		name: raw.name || "",
		description: raw.description || "",
		nodes: {},
		edges: [],
		loops: undefined,
		human_gates: undefined,
	};

	// Parse nodes
	if (raw.nodes && typeof raw.nodes === "object") {
		for (const [name, def] of Object.entries(raw.nodes)) {
			const d = def as any;
			graph.nodes[name] = {
				persona: d.persona || "",
				schema: d.schema || "",
				tools: d.tools,
				prompt: d.prompt || "",
				model: d.model,
			};
		}
	}

	// Parse edges
	if (Array.isArray(raw.edges)) {
		for (const e of raw.edges) {
			graph.edges.push({
				from: e.from || "",
				to: e.to || "",
			});
		}
	}

	// Parse loops
	if (raw.loops && typeof raw.loops === "object") {
		graph.loops = {};
		for (const [name, def] of Object.entries(raw.loops)) {
			const d = def as any;
			graph.loops[name] = {
				nodes: Array.isArray(d.nodes) ? d.nodes : [],
				until: d.until,
				for_each: d.for_each,
				max_cycles: typeof d.max_cycles === "number" ? d.max_cycles : 0,
				on_max: d.on_max,
				pass_context: Array.isArray(d.pass_context) ? d.pass_context : undefined,
			};
		}
	}

	// Parse human gates
	if (Array.isArray(raw.human_gates)) {
		graph.human_gates = raw.human_gates.map((g: any) => ({
			after: g.after || "",
			title: g.title || "",
			display: Array.isArray(g.display) ? g.display : [],
			options: Array.isArray(g.options)
				? g.options.map((o: any) => ({
						label: o.label || "",
						routes_to: o.routes_to || "",
					}))
				: [],
		}));
	}

	return graph;
}

// ── Phase 1: Graph Validator ────────────────────────────────────────────────

/**
 * Validate a parsed graph definition.
 * Checks structural integrity, file existence, and template references.
 */
export function validateGraph(graph: GraphDef, baseDir: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Collect all known node names
	const nodeNames = new Set(Object.keys(graph.nodes));
	const loopNames = new Set(Object.keys(graph.loops || {}));
	const allNames = new Set([...nodeNames, ...loopNames]);

	// Special edge targets
	const terminals = new Set(["START", "DONE", "HUMAN_GATE", "BLOCKED"]);

	// (a) All nodes referenced in edges exist
	for (const edge of graph.edges) {
		if (edge.from !== "START" && !allNames.has(edge.from)) {
			errors.push(`Edge references unknown source: "${edge.from}"`);
		}
		if (!terminals.has(edge.to) && !allNames.has(edge.to)) {
			errors.push(`Edge references unknown target: "${edge.to}"`);
		}
	}

	// All nodes referenced in loops exist
	if (graph.loops) {
		for (const [loopName, loop] of Object.entries(graph.loops)) {
			for (const nodeName of loop.nodes) {
				if (!nodeNames.has(nodeName)) {
					errors.push(`Loop "${loopName}" references unknown node: "${nodeName}"`);
				}
			}
		}
	}

	// (b) All edges reachable from START
	const startEdges = graph.edges.filter((e) => e.from === "START");
	if (startEdges.length === 0) {
		errors.push("No edge from START found");
	}

	const reachable = new Set<string>();
	const queue: string[] = startEdges.map((e) => e.to);
	while (queue.length > 0) {
		const current = queue.shift()!;
		if (reachable.has(current) || terminals.has(current)) continue;
		reachable.add(current);

		// If it's a loop, add its internal nodes to reachable
		if (graph.loops && graph.loops[current]) {
			for (const n of graph.loops[current].nodes) {
				reachable.add(n);
			}
		}

		// Follow outbound edges
		for (const edge of graph.edges) {
			if (edge.from === current) {
				queue.push(edge.to);
			}
		}
	}

	for (const name of nodeNames) {
		if (!reachable.has(name)) {
			errors.push(`Node "${name}" is not reachable from START`);
		}
	}
	for (const name of loopNames) {
		if (!reachable.has(name)) {
			errors.push(`Loop "${name}" is not reachable from START`);
		}
	}

	// (c) No dead-end nodes (every non-terminal node has an outbound edge)
	const nodesWithOutbound = new Set(graph.edges.map((e) => e.from));
	for (const name of allNames) {
		// Nodes inside loops get their routing from the loop, not direct edges
		const isInLoop = graph.loops && Object.values(graph.loops).some((l) => l.nodes.includes(name));
		if (!isInLoop && !nodesWithOutbound.has(name)) {
			errors.push(`Node/loop "${name}" has no outbound edge (dead end)`);
		}
	}

	// (d) Loops have max_cycles set and are either until OR for_each (not both, not neither)
	if (graph.loops) {
		for (const [name, loop] of Object.entries(graph.loops)) {
			if (!loop.max_cycles || loop.max_cycles <= 0) {
				errors.push(`Loop "${name}" has no max_cycles set (unbounded loop)`);
			}
			if (loop.until && loop.for_each) {
				errors.push(`Loop "${name}" has both "until" and "for_each" — must have one or the other`);
			}
			if (!loop.until && !loop.for_each) {
				errors.push(`Loop "${name}" has neither "until" nor "for_each" — must have one`);
			}
			// Validate on_max references a known terminal or node
			if (loop.on_max) {
				const knownTerminals = new Set(["DONE", "BLOCKED", "ERROR"]);
				if (!knownTerminals.has(loop.on_max) && !allNames.has(loop.on_max)) {
					errors.push(`Loop "${name}" on_max value "${loop.on_max}" is not a known terminal (DONE, BLOCKED, ERROR) or node`);
				}
			}
		}
	}

	// (e) Template variables reference nodes that exist
	// Collect all template strings from prompts and human gate displays
	const templateStrings: Array<{ source: string; template: string }> = [];

	for (const [name, node] of Object.entries(graph.nodes)) {
		if (node.prompt) {
			templateStrings.push({ source: `node "${name}" prompt`, template: node.prompt });
		}
	}

	if (graph.human_gates) {
		for (const gate of graph.human_gates) {
			for (const display of gate.display) {
				templateStrings.push({ source: `human gate "${gate.title}" display`, template: display });
			}
		}
	}

	// Match deep dot-paths: {{node.output.field}}, {{node.output.field.subfield}}, etc.
	const templateVarRegex = /\{\{(\w+)\.output(?:\.\w+)+\}\}/g;
	// Also match node references inside {{#if node.output.field}} conditionals
	const templateIfRegex = /\{\{#if\s+(\w+)\.output(?:\.\w+)+\}\}/g;
	for (const { source, template } of templateStrings) {
		let match;
		templateVarRegex.lastIndex = 0;
		while ((match = templateVarRegex.exec(template)) !== null) {
			const referencedNode = match[1];
			if (referencedNode !== "input" && !nodeNames.has(referencedNode)) {
				errors.push(`Template in ${source} references non-existent node: "${referencedNode}"`);
			}
		}
		templateIfRegex.lastIndex = 0;
		while ((match = templateIfRegex.exec(template)) !== null) {
			const referencedNode = match[1];
			if (referencedNode !== "input" && !nodeNames.has(referencedNode)) {
				errors.push(`Template in ${source} references non-existent node in conditional: "${referencedNode}"`);
			}
		}
	}

	// (f) Persona .md and schema .json files exist on disk
	for (const [name, node] of Object.entries(graph.nodes)) {
		const personaPath = join(baseDir, node.persona);
		if (!existsSync(personaPath)) {
			errors.push(`Node "${name}" persona file not found: ${node.persona}`);
		}

		const schemaPath = join(baseDir, node.schema);
		if (!existsSync(schemaPath)) {
			errors.push(`Node "${name}" schema file not found: ${node.schema}`);
		}
	}

	// (g) Human gates reference valid nodes in `after` + correlate with HUMAN_GATE edges
	if (graph.human_gates) {
		for (const gate of graph.human_gates) {
			if (!allNames.has(gate.after)) {
				errors.push(`Human gate "${gate.title}" references unknown node/loop in "after": "${gate.after}"`);
			}
		}
	}

	// Every edge targeting HUMAN_GATE should have a corresponding gate definition
	const humanGateEdges = graph.edges.filter((e) => e.to === "HUMAN_GATE");
	for (const edge of humanGateEdges) {
		const hasMatchingGate = graph.human_gates?.some((g) => g.after === edge.from);
		if (!hasMatchingGate) {
			errors.push(`Edge from "${edge.from}" to HUMAN_GATE has no corresponding human gate definition with after: "${edge.from}"`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

// ── Phase 2: Template Interpolation ─────────────────────────────────────────

/**
 * Template context shape used at runtime.
 * - input: the original user input string
 * - outputs: { nodeName: { ...structured output } }
 * - loopVars: { varName: value } for current loop iteration
 * Any top-level key can also be accessed directly for convenience.
 */
export interface TemplateContext {
	input?: string;
	outputs?: Record<string, Record<string, any>>;
	loopVars?: Record<string, any>;
	[key: string]: any;
}

/**
 * Traverse a nested object by dot-separated path.
 * Returns undefined if any segment is missing.
 */
function getByDotPath(obj: any, path: string): any {
	const parts = path.split(".");
	let current = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = current[part];
	}
	return current;
}

/**
 * Resolve a template string against a context object.
 *
 * Supported patterns:
 *   {{input}}                           — context.input
 *   {{nodeName.output}}                 — JSON.stringify(context.outputs[nodeName])
 *   {{nodeName.output.field.sub}}       — dot-path into context.outputs[nodeName]
 *   {{loop_var}}                        — context.loopVars[loop_var] or context[loop_var]
 *   {{#if varName}}...{{/if}}           — conditional block (truthy = present and non-empty)
 */
export function resolveTemplate(template: string, context: TemplateContext): string {
	let result = template;

	// 1. Process {{#if varName}}...{{/if}} blocks (non-greedy, no nesting)
	result = result.replace(/\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, varExpr: string, body: string) => {
		const value = resolveVar(varExpr.trim(), context);
		// Truthy: present, non-null, non-empty-string, non-empty-array
		if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
			return "";
		}
		return body;
	});

	// 2. Process {{variable}} interpolations
	result = result.replace(/\{\{([^#/}][^}]*?)\}\}/g, (_match, varExpr: string) => {
		const value = resolveVar(varExpr.trim(), context);
		if (value === undefined || value === null) return "";
		if (typeof value === "object") return JSON.stringify(value);
		return String(value);
	});

	return result;
}

/**
 * Resolve a single variable expression against the context.
 *
 * Resolution order for "nodeName.output.field":
 *   1. context.outputs[nodeName] -> traverse .field
 * Resolution for "nodeName.output" (no further path):
 *   1. context.outputs[nodeName] (full object)
 * Resolution for simple "varName":
 *   1. context[varName] (e.g., context.input)
 *   2. context.loopVars[varName]
 */
function resolveVar(expr: string, context: TemplateContext): any {
	// Check for nodeName.output or nodeName.output.field pattern
	const outputMatch = expr.match(/^(\w+)\.output(?:\.(.+))?$/);
	if (outputMatch) {
		const [, nodeName, fieldPath] = outputMatch;
		const nodeOutput = context.outputs?.[nodeName];
		if (nodeOutput === undefined) return undefined;
		if (!fieldPath) return nodeOutput; // {{nodeName.output}} — full object
		return getByDotPath(nodeOutput, fieldPath);
	}

	// Simple variable: check direct context, then loopVars
	if (context[expr] !== undefined) return context[expr];
	if (context.loopVars?.[expr] !== undefined) return context.loopVars[expr];
	return undefined;
}

// ── Phase 2: Worker Spawner ────────────────────────────────────────────────

const __filename_ge = fileURLToPath(import.meta.url);
const __dirname_ge = dirname(__filename_ge);
const WORKER_PATH = join(__dirname_ge, "test-worker.ts");

/**
 * Spawn a headless Pi worker for a graph node.
 *
 * Reads persona .md and schema .json from disk, passes them via env vars
 * to test-worker.ts. Parses JSONL stdout for tool_execution_start events
 * with toolName === "submit_results" and extracts args.
 *
 * @param nodeDef   - The node definition from the graph
 * @param resolvedPrompt - The prompt after template interpolation
 * @param baseDir   - Base directory for resolving persona/schema paths
 * @param model     - Optional model override
 * @param timeout   - Timeout in ms (default 120000)
 * @returns Structured JSON args from the worker's tool call
 */
export function spawnGraphNode(
	nodeDef: NodeDef,
	resolvedPrompt: string,
	baseDir: string,
	model?: string,
	timeout: number = 120_000,
): Promise<Record<string, any>> {
	return new Promise((resolve, reject) => {
		// Read persona and schema from disk
		const personaContent = readFileSync(join(baseDir, nodeDef.persona), "utf-8");
		const schemaContent = readFileSync(join(baseDir, nodeDef.schema), "utf-8");

		const toolName = "submit_results";
		const toolDesc = "Submit your structured results.";

		// Build spawn args
		const args: string[] = [
			"-p",
			"--mode", "json",
			"--no-extensions",
			"-e", WORKER_PATH,
			"--no-session",
		];

		// Task 2.3: tools field handling
		if (nodeDef.tools) {
			args.push("--tools", nodeDef.tools);
		} else {
			args.push("--no-tools");
		}

		args.push("--thinking", "off");

		// Optional model override
		if (model) {
			args.push("--model", model);
		}

		// The prompt is the final positional argument
		args.push(resolvedPrompt);

		const proc = spawn("pi", args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				WORKER_SYSTEM_PROMPT: personaContent,
				WORKER_TOOL_NAME: toolName,
				WORKER_TOOL_DESC: toolDesc,
				WORKER_SCHEMA: schemaContent,
			},
		});

		let toolArgs: any = null;
		let buffer = "";
		let stderrText = "";
		let timedOut = false;

		// Configurable timeout
		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGTERM");
		}, timeout);

		proc.stdout!.setEncoding("utf-8");
		proc.stdout!.on("data", (chunk: string) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (event.type === "tool_execution_start" && event.toolName === toolName) {
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
			clearTimeout(timer);

			// Process remaining buffer
			if (buffer.trim()) {
				try {
					const event = JSON.parse(buffer);
					if (event.type === "tool_execution_start" && event.toolName === toolName) {
						toolArgs = event.args;
					}
				} catch {}
			}

			if (timedOut) {
				reject(new Error(`Worker timed out after ${timeout / 1000}s`));
			} else if (toolArgs) {
				resolve(toolArgs);
			} else {
				reject(
					new Error(
						`Worker exited code ${code} without calling "${toolName}". Stderr: ${stderrText.slice(0, 500)}`,
					),
				);
			}
		});

		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

// ── Extension Entry Point (Phase 4 — placeholder) ──────────────────────────

export default function (pi: ExtensionAPI) {
	// Commands will be registered in Phase 4
}
