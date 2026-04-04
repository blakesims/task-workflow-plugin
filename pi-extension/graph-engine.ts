import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { parse as parseYaml } from "yaml";
import { existsSync, readFileSync, readdirSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
// pi-tui is only available inside Pi runtime — lazy-loaded to avoid breaking tests
let Text: any;
let _tuiLoaded = false;

async function loadTuiModules() {
	if (_tuiLoaded) return;
	try {
		const tui = await import("@mariozechner/pi-tui");
		Text = tui.Text;
		_tuiLoaded = true;
	} catch {
		// Not in Pi runtime (tests) — Text stays null, widget is a no-op
	}
}

/** Local type matching pi-tui's AutocompleteItem to avoid top-level import */
interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}

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
	when?: string;         // Optional condition: "node.output.field === 'value'"
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
	lastWork?: string;
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

/** Result of graph execution. */
export interface GraphResult {
	status: "completed" | "blocked" | "error";
	outputs: Record<string, Record<string, any>>;
	humanGateSelection?: string;  // Label selected at human gate
	elapsedMs: number;
	error?: string;
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
			const edge: EdgeDef = {
				from: e.from || "",
				to: e.to || "",
			};
			if (e.when) edge.when = e.when;
			graph.edges.push(edge);
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
		// Falsy: undefined, null, false, 0, empty string, empty array
		if (value === undefined || value === null || value === false || value === 0 || value === "" || (Array.isArray(value) && value.length === 0)) {
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
	onTextDelta?: (text: string) => void,
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
					if (event.type === "text_delta" && event.text && onTextDelta) {
						onTextDelta(event.text);
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

// ── Phase 3: Safe Condition Evaluator ──────────────────────────────────────

/**
 * Safely evaluate a condition string against graph state outputs.
 * Supports patterns:
 *   "node.output.field === 'value'"
 *   "node.output.field !== 'value'"
 *   "node.output.field > N"
 *   "node.output.field < N"
 *   "node.output.field >= N"
 *   "node.output.field <= N"
 *
 * Does NOT use eval(). Returns false with a warning for unparseable conditions.
 */
export function evaluateCondition(
	condition: string,
	outputs: Record<string, Record<string, any>>,
): { result: boolean; warning?: string } {
	// Pattern: dotpath OPERATOR value
	const match = condition.match(
		/^(\w+)\.output\.(\S+?)\s*(===|!==|>=|<=|>|<)\s*(.+)$/
	);

	if (!match) {
		return {
			result: false,
			warning: `Unparseable condition (treating as false): "${condition}"`,
		};
	}

	const [, nodeName, fieldPath, operator, rawValue] = match;

	// Resolve the left side from outputs
	const nodeOutput = outputs[nodeName];
	if (nodeOutput === undefined) {
		return { result: false };
	}
	const actual = getByDotPath(nodeOutput, fieldPath);

	// Parse the right side value
	let expected: any;
	const strMatch = rawValue.match(/^['"](.*)['"]$/);
	if (strMatch) {
		expected = strMatch[1]; // String literal
	} else if (rawValue === "true") {
		expected = true;
	} else if (rawValue === "false") {
		expected = false;
	} else if (rawValue === "null") {
		expected = null;
	} else {
		const num = Number(rawValue);
		if (!isNaN(num)) {
			expected = num;
		} else {
			return {
				result: false,
				warning: `Cannot parse value in condition: "${rawValue}"`,
			};
		}
	}

	// Evaluate
	switch (operator) {
		case "===": return { result: actual === expected };
		case "!==": return { result: actual !== expected };
		case ">":   return { result: actual > expected };
		case "<":   return { result: actual < expected };
		case ">=":  return { result: actual >= expected };
		case "<=":  return { result: actual <= expected };
		default:
			return {
				result: false,
				warning: `Unknown operator in condition: "${operator}"`,
			};
	}
}

// ── Phase 3: Edge Following ───────────────────────────────────────────────

/**
 * Find the next target after a node/loop completes.
 * Evaluates `when` conditions in order; first match wins.
 * Edges without `when` act as default/fallback.
 */
export function findNextTarget(
	from: string,
	edges: EdgeDef[],
	outputs: Record<string, Record<string, any>>,
): { target: string; warning?: string } {
	const outbound = edges.filter((e) => e.from === from);
	if (outbound.length === 0) {
		return { target: "DONE", warning: `No outbound edge from "${from}", defaulting to DONE` };
	}

	// Separate conditional and default edges
	const conditional = outbound.filter((e) => e.when);
	const defaults = outbound.filter((e) => !e.when);

	// Evaluate conditional edges in order
	for (const edge of conditional) {
		const { result, warning } = evaluateCondition(edge.when!, outputs);
		if (warning) {
			// Log but continue checking other edges
		}
		if (result) {
			return { target: edge.to, warning };
		}
	}

	// Fall back to default edge
	if (defaults.length > 0) {
		return { target: defaults[0].to };
	}

	// No matching condition and no default
	return {
		target: "BLOCKED",
		warning: `No matching edge from "${from}" (${conditional.length} conditional edges, none matched)`,
	};
}

// ── Phase 3: Until Loop Execution ─────────────────────────────────────────

/**
 * Execute an `until` loop: run nodes in sequence, check condition, repeat.
 */
async function executeUntilLoop(
	loopName: string,
	loopDef: LoopDef,
	graph: GraphDef,
	state: GraphState,
	baseDir: string,
	ctx: ExtensionContext,
	model?: string,
): Promise<{ status: "completed" | "blocked" | "error"; warning?: string; routeTo?: string }> {
	for (let cycle = 1; cycle <= loopDef.max_cycles; cycle++) {
		state.loopCycles[loopName] = cycle;
		state.currentLoop = loopName;

		// Execute each node in the loop sequence
		for (const nodeName of loopDef.nodes) {
			state.currentNode = nodeName;
			state.nodeStates[nodeName] = {
				status: "running",
				startedAt: Date.now(),
			};

			try {
				const nodeDef = graph.nodes[nodeName];
				if (!nodeDef) {
					throw new Error(`Loop "${loopName}" references unknown node: "${nodeName}"`);
				}

				// Build template context from state
				const templateContext: TemplateContext = {
					input: state.input,
					outputs: state.outputs,
					loopVars: {},
				};

				// Add pass_context variables from previous cycle
				if (loopDef.pass_context && cycle > 1) {
					for (const varPath of loopDef.pass_context) {
						// pass_context entries are dot-paths like "reviewer.output.challenges"
						const outputMatch = varPath.match(/^(\w+)\.output\.(.+)$/);
						if (outputMatch) {
							const [, srcNode, field] = outputMatch;
							const val = getByDotPath(state.outputs[srcNode], field);
							if (val !== undefined) {
								templateContext.loopVars![field] = val;
							}
						}
					}
				}

				const resolvedPrompt = resolveTemplate(nodeDef.prompt, templateContext);
				const nodeModel = nodeDef.model || model;
				const output = await spawnGraphNode(nodeDef, resolvedPrompt, baseDir, nodeModel, 120_000, (text) => {
					state.nodeStates[nodeName].lastWork = text;
				});

				state.outputs[nodeName] = output;
				state.nodeStates[nodeName] = {
					status: "done",
					output,
					startedAt: state.nodeStates[nodeName].startedAt,
					completedAt: Date.now(),
					lastWork: state.nodeStates[nodeName].lastWork,
				};
			} catch (err: any) {
				state.nodeStates[nodeName] = {
					status: "error",
					error: err.message,
					startedAt: state.nodeStates[nodeName].startedAt,
					completedAt: Date.now(),
					lastWork: state.nodeStates[nodeName].lastWork,
				};
				return { status: "error", warning: `Node "${nodeName}" failed: ${err.message}` };
			}
		}

		// Evaluate the until condition
		const { result, warning } = evaluateCondition(loopDef.until!, state.outputs);
		if (warning) {
			ctx.ui.notify(`Loop "${loopName}" cycle ${cycle}: ${warning}`, "warning");
		}

		if (result) {
			state.currentLoop = null;
			return { status: "completed" };
		}
	}

	// max_cycles exceeded
	state.currentLoop = null;
	const onMax = loopDef.on_max || "BLOCKED";
	ctx.ui.notify(
		`Loop "${loopName}" reached max_cycles (${loopDef.max_cycles}), transitioning to ${onMax}`,
		"warning",
	);

	if (onMax === "ERROR") return { status: "error" };
	if (onMax === "BLOCKED") return { status: "blocked" };
	if (onMax === "DONE") return { status: "completed", routeTo: "DONE" };
	// on_max is a node name — return it so the caller can route there
	return { status: "completed", routeTo: onMax };
}

// ── Phase 3: ForEach Loop Execution ───────────────────────────────────────

/**
 * Execute a `for_each` loop: iterate over an array, execute nodes for each element.
 * Output keying: each iteration overwrites node outputs, but also stores
 * indexed copies as `nodeName_0`, `nodeName_1`, etc. for downstream access.
 */
async function executeForEachLoop(
	loopName: string,
	loopDef: LoopDef,
	graph: GraphDef,
	state: GraphState,
	baseDir: string,
	ctx: ExtensionContext,
	model?: string,
): Promise<{ status: "completed" | "blocked" | "error"; warning?: string }> {
	// Resolve the array from for_each dot-path
	const forEachPath = loopDef.for_each!;
	const pathMatch = forEachPath.match(/^(\w+)\.output\.(.+)$/);
	if (!pathMatch) {
		return {
			status: "error",
			warning: `Invalid for_each path: "${forEachPath}"`,
		};
	}

	const [, srcNode, fieldPath] = pathMatch;
	const sourceArray = getByDotPath(state.outputs[srcNode], fieldPath);

	if (!Array.isArray(sourceArray)) {
		return {
			status: "error",
			warning: `for_each path "${forEachPath}" did not resolve to an array (got ${typeof sourceArray})`,
		};
	}

	const maxIterations = Math.min(sourceArray.length, loopDef.max_cycles);
	state.currentLoop = loopName;

	for (let i = 0; i < maxIterations; i++) {
		state.loopCycles[loopName] = i + 1;
		const element = sourceArray[i];

		for (const nodeName of loopDef.nodes) {
			state.currentNode = nodeName;
			state.nodeStates[nodeName] = {
				status: "running",
				startedAt: Date.now(),
			};

			try {
				const nodeDef = graph.nodes[nodeName];
				if (!nodeDef) {
					throw new Error(`Loop "${loopName}" references unknown node: "${nodeName}"`);
				}

				// Build template context with loop variable
				const templateContext: TemplateContext = {
					input: state.input,
					outputs: state.outputs,
					loopVars: {
						item: element,          // Generic loop var
						index: i,               // Current index
					},
				};

				const resolvedPrompt = resolveTemplate(nodeDef.prompt, templateContext);
				const nodeModel = nodeDef.model || model;
				const output = await spawnGraphNode(nodeDef, resolvedPrompt, baseDir, nodeModel, 120_000, (text) => {
					state.nodeStates[nodeName].lastWork = text;
				});

				// Store both overwriting and indexed
				state.outputs[nodeName] = output;
				state.outputs[`${nodeName}_${i}`] = output;
				state.nodeStates[nodeName] = {
					status: "done",
					output,
					startedAt: state.nodeStates[nodeName].startedAt,
					completedAt: Date.now(),
					lastWork: state.nodeStates[nodeName].lastWork,
				};
			} catch (err: any) {
				state.nodeStates[nodeName] = {
					status: "error",
					error: err.message,
					startedAt: state.nodeStates[nodeName].startedAt,
					completedAt: Date.now(),
					lastWork: state.nodeStates[nodeName].lastWork,
				};
				return { status: "error", warning: `Node "${nodeName}" (iteration ${i}) failed: ${err.message}` };
			}
		}
	}

	if (sourceArray.length > loopDef.max_cycles) {
		ctx.ui.notify(
			`for_each loop "${loopName}" capped at max_cycles (${loopDef.max_cycles}), array had ${sourceArray.length} items`,
			"warning",
		);
	}

	state.currentLoop = null;
	return { status: "completed" };
}

// ── Phase 3: Human Gate Execution ─────────────────────────────────────────

/**
 * Execute a human gate: display info, present options via ctx.ui.select().
 * Maps the returned label string back to the option's routes_to value.
 */
async function executeHumanGate(
	gateDef: HumanGateDef,
	state: GraphState,
	ctx: ExtensionContext,
): Promise<{ routesTo: string; selectedLabel: string }> {
	// Build template context for display strings
	const templateContext: TemplateContext = {
		input: state.input,
		outputs: state.outputs,
	};

	// Resolve display templates
	const displayLines = gateDef.display.map((d) =>
		resolveTemplate(d, templateContext)
	);

	// Extract labels for select()
	const labels = gateDef.options.map((o) => o.label);

	// Check if UI is available
	if (!ctx.hasUI) {
		const firstOption = gateDef.options[0];
		ctx.ui.notify(
			`Headless mode: auto-selecting "${firstOption.label}" for gate "${gateDef.title}"`,
			"warning",
		);
		return { routesTo: firstOption.routes_to, selectedLabel: firstOption.label };
	}

	// Show display lines as info notifications
	for (const line of displayLines) {
		ctx.ui.notify(line, "info");
	}

	// Present options via select()
	const selected = await ctx.ui.select(gateDef.title, labels);

	if (selected === undefined) {
		// User cancelled — treat as first option with warning
		const firstOption = gateDef.options[0];
		ctx.ui.notify(
			`Gate cancelled, defaulting to "${firstOption.label}"`,
			"warning",
		);
		return { routesTo: firstOption.routes_to, selectedLabel: firstOption.label };
	}

	// Map selected label back to routes_to
	const matchedOption = gateDef.options.find((o) => o.label === selected);
	if (!matchedOption) {
		// Should not happen, but handle defensively
		const firstOption = gateDef.options[0];
		ctx.ui.notify(
			`Unknown selection "${selected}", defaulting to "${firstOption.label}"`,
			"warning",
		);
		return { routesTo: firstOption.routes_to, selectedLabel: firstOption.label };
	}

	return { routesTo: matchedOption.routes_to, selectedLabel: matchedOption.label };
}

// ── Phase 3: Main Graph Executor ──────────────────────────────────────────

/**
 * Execute a graph from start to completion.
 *
 * Algorithm:
 *   1. Find START edge, resolve target
 *   2. If target is a node: execute it, follow outbound edge
 *   3. If target is a loop: execute the loop, follow outbound edge
 *   4. If target is HUMAN_GATE: find gate def, present options, route
 *   5. If target is DONE/BLOCKED: terminate
 *   6. Repeat from step 2
 */
export async function executeGraph(
	graph: GraphDef,
	input: string,
	baseDir: string,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	sharedState?: GraphState,
	model?: string,
): Promise<GraphResult> {
	const startTime = Date.now();

	// Use shared state if provided (for TUI widget), otherwise create local
	const state: GraphState = sharedState || {
		graphName: graph.name,
		status: "running",
		currentNode: null,
		currentLoop: null,
		loopCycles: {},
		nodeStates: {},
		outputs: {},
		input,
		startedAt: startTime,
	};

	// Initialize if using fresh state
	if (!sharedState) {
		state.status = "running";
		state.input = input;
		state.startedAt = startTime;
		for (const name of Object.keys(graph.nodes)) {
			state.nodeStates[name] = { status: "idle" };
		}
	}

	ctx.ui.notify(`Starting graph: ${graph.name}`, "info");

	try {
		// Find START edge
		const startEdge = graph.edges.find((e) => e.from === "START");
		if (!startEdge) {
			throw new Error("No START edge found in graph");
		}

		let currentTarget = startEdge.to;

		// Main execution loop
		while (currentTarget !== "DONE" && currentTarget !== "BLOCKED" && currentTarget !== "ERROR") {
			// Check if target is a loop
			if (graph.loops && graph.loops[currentTarget]) {
				const loopDef = graph.loops[currentTarget];
				const loopName = currentTarget;

				let loopResult: { status: string; warning?: string; routeTo?: string };

				if (loopDef.until) {
					loopResult = await executeUntilLoop(
						loopName, loopDef, graph, state, baseDir, ctx, model,
					);
				} else if (loopDef.for_each) {
					loopResult = await executeForEachLoop(
						loopName, loopDef, graph, state, baseDir, ctx, model,
					);
				} else {
					throw new Error(`Loop "${loopName}" has neither until nor for_each`);
				}

				if (loopResult.status === "error") {
					state.status = "error";
					return {
						status: "error",
						outputs: state.outputs,
						elapsedMs: Date.now() - startTime,
						error: loopResult.warning || "Loop execution failed",
					};
				}

				if (loopResult.status === "blocked") {
					// If loop hit max_cycles with on_max=BLOCKED
					state.status = "blocked";
					return {
						status: "blocked",
						outputs: state.outputs,
						elapsedMs: Date.now() - startTime,
					};
				}

				// If loop returned a specific route (on_max with DONE or node name), use it
				if (loopResult.routeTo) {
					currentTarget = loopResult.routeTo;
				} else {
					// Loop completed normally — follow outbound edge
					const { target, warning } = findNextTarget(loopName, graph.edges, state.outputs);
					if (warning) ctx.ui.notify(warning, "warning");
					currentTarget = target;
				}

			} else if (currentTarget === "HUMAN_GATE") {
				// Find the matching human gate definition
				// The gate's `after` field tells us which node/loop preceded this gate
				// We need to find which edge led us here to determine the `after` source
				const gateEdge = graph.edges.find(
					(e) => e.to === "HUMAN_GATE" &&
					// The source must have already been executed
					(state.outputs[e.from] !== undefined ||
					 (graph.loops && graph.loops[e.from] !== undefined && state.loopCycles[e.from] !== undefined))
				);

				let gateDef: HumanGateDef | undefined;
				if (gateEdge) {
					gateDef = graph.human_gates?.find((g) => g.after === gateEdge.from);
				}
				if (!gateDef) {
					// Fallback: use first gate
					gateDef = graph.human_gates?.[0];
				}

				if (!gateDef) {
					throw new Error("Reached HUMAN_GATE but no gate definition found");
				}

				const { routesTo, selectedLabel } = await executeHumanGate(gateDef, state, ctx);
				state.outputs["__human_gate__"] = { selection: selectedLabel, routes_to: routesTo };

				currentTarget = routesTo;

			} else if (graph.nodes[currentTarget]) {
				// Execute a single node
				const nodeName = currentTarget;
				const nodeDef = graph.nodes[nodeName];

				state.currentNode = nodeName;
				state.nodeStates[nodeName] = {
					status: "running",
					startedAt: Date.now(),
				};

				try {
					const templateContext: TemplateContext = {
						input: state.input,
						outputs: state.outputs,
					};

					const resolvedPrompt = resolveTemplate(nodeDef.prompt, templateContext);
					const nodeModel = nodeDef.model || model;
					const output = await spawnGraphNode(nodeDef, resolvedPrompt, baseDir, nodeModel, 120_000, (text) => {
						state.nodeStates[nodeName].lastWork = text;
					});

					state.outputs[nodeName] = output;
					state.nodeStates[nodeName] = {
						status: "done",
						output,
						startedAt: state.nodeStates[nodeName].startedAt,
						completedAt: Date.now(),
						lastWork: state.nodeStates[nodeName].lastWork,
					};
				} catch (err: any) {
					state.nodeStates[nodeName] = {
						status: "error",
						error: err.message,
						startedAt: state.nodeStates[nodeName].startedAt,
						completedAt: Date.now(),
						lastWork: state.nodeStates[nodeName].lastWork,
					};
					throw err; // Re-throw to hit the outer catch
				}

				// Follow outbound edge
				const { target, warning } = findNextTarget(nodeName, graph.edges, state.outputs);
				if (warning) ctx.ui.notify(warning, "warning");
				currentTarget = target;

			} else {
				throw new Error(`Unknown target: "${currentTarget}" — not a node, loop, or terminal`);
			}
		}

		// Terminal state
		state.status = currentTarget === "DONE" ? "completed" : "blocked";
		state.completedAt = Date.now();

		const resultStatus = currentTarget === "DONE" ? "completed" as const :
		                     currentTarget === "BLOCKED" ? "blocked" as const :
		                     "error" as const;

		ctx.ui.notify(
			`Graph "${graph.name}" finished: ${resultStatus} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
			"info",
		);

		return {
			status: resultStatus,
			outputs: state.outputs,
			humanGateSelection: state.outputs["__human_gate__"]?.selection,
			elapsedMs: Date.now() - startTime,
		};

	} catch (err: any) {
		state.status = "error";
		state.completedAt = Date.now();

		ctx.ui.notify(`Graph error: ${err.message}`, "error");

		return {
			status: "error",
			outputs: state.outputs,
			elapsedMs: Date.now() - startTime,
			error: err.message,
		};
	}
}

// ── Phase 4: TUI Widget ─────────────────────────────────────────────────────

const GRAPHS_DIR = join(__dirname_ge, "graphs");

/**
 * Discover available .yaml graph files in the graphs/ directory.
 */
export function discoverGraphs(): Array<{ file: string; name: string; description: string }> {
	if (!existsSync(GRAPHS_DIR)) return [];
	const results: Array<{ file: string; name: string; description: string }> = [];
	try {
		for (const file of readdirSync(GRAPHS_DIR)) {
			if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
			try {
				const raw = readFileSync(join(GRAPHS_DIR, file), "utf-8");
				const parsed = parseYaml(raw);
				results.push({
					file,
					name: parsed?.name || file.replace(/\.ya?ml$/, ""),
					description: parsed?.description || "",
				});
			} catch {}
		}
	} catch {}
	return results;
}

/**
 * Render a single node as a bordered card box.
 * Modeled on agent-team.ts renderCard (lines 206-253).
 * Returns string[] (one per visual line).
 */
export function renderCard(
	name: string,
	ns: NodeState,
	cardWidth: number,
	theme: any,
): string[] {
	const w = cardWidth - 2; // inner width (excluding │ borders)
	const truncate = (s: string, max: number) =>
		s.length > max ? s.slice(0, max - 3) + "..." : s;

	const statusColor =
		ns.status === "idle" ? "dim" :
		ns.status === "running" ? "accent" :
		ns.status === "done" ? "success" : "error";
	const statusIcon =
		ns.status === "idle" ? "○" :
		ns.status === "running" ? "●" :
		ns.status === "done" ? "✓" : "✗";

	// Name line (bold accent)
	const nameStr = theme.fg("accent", theme.bold(truncate(name, w - 1)));
	const nameVisible = Math.min(name.length, w - 1);

	// Status + elapsed line
	const statusStr = `${statusIcon} ${ns.status}`;
	const timeStr = ns.startedAt
		? ` ${Math.round(((ns.completedAt || Date.now()) - ns.startedAt) / 1000)}s`
		: "";
	const statusLine = theme.fg(statusColor, statusStr + timeStr);
	const statusVisible = statusStr.length + timeStr.length;

	// Work/output preview line
	const workRaw = ns.lastWork
		? ns.lastWork
		: ns.output
			? JSON.stringify(ns.output)
			: "";
	const workText = truncate(workRaw, Math.min(50, w - 1));
	const workLine = theme.fg("dim", workText);
	const workVisible = workText.length;

	// Borders
	const top = "┌" + "─".repeat(w) + "┐";
	const bot = "└" + "─".repeat(w) + "┘";
	const border = (content: string, visLen: number) =>
		theme.fg("dim", "│") + content + " ".repeat(Math.max(0, w - visLen)) + theme.fg("dim", "│");

	return [
		theme.fg("dim", top),
		border(" " + nameStr, 1 + nameVisible),
		border(" " + statusLine, 1 + statusVisible),
		border(" " + workLine, 1 + workVisible),
		theme.fg("dim", bot),
	];
}

/**
 * Render the graph execution widget.
 * Shows node cards with status icons, elapsed time, output previews.
 * Loop sections show cycle counters. Cards connected by arrows.
 */
export function renderGraphWidget(
	state: GraphState,
	graph: GraphDef,
	theme: any,
	width: number,
): string[] {
	const lines: string[] = [];
	const nodeNames = Object.keys(graph.nodes);
	if (nodeNames.length === 0) return [theme.fg("dim", "No nodes in graph")];

	// Determine which nodes belong to loops
	const loopMembership: Record<string, string> = {}; // nodeName -> loopName
	if (graph.loops) {
		for (const [loopName, loopDef] of Object.entries(graph.loops)) {
			for (const n of loopDef.nodes) {
				loopMembership[n] = loopName;
			}
		}
	}

	// Render nodes in graph order (edges define traversal), grouped by loops
	const renderedNodes = new Set<string>();
	const renderOrder: Array<{ type: "node"; name: string } | { type: "loop_start"; name: string } | { type: "loop_end"; name: string }> = [];

	// Walk edges from START to build render order
	const visited = new Set<string>();
	let target = graph.edges.find(e => e.from === "START")?.to;
	while (target && !visited.has(target) && target !== "DONE" && target !== "BLOCKED" && target !== "ERROR" && target !== "HUMAN_GATE") {
		visited.add(target);

		if (graph.loops && graph.loops[target]) {
			// Loop section
			const loopDef = graph.loops[target];
			renderOrder.push({ type: "loop_start", name: target });
			for (const n of loopDef.nodes) {
				renderOrder.push({ type: "node", name: n });
				renderedNodes.add(n);
			}
			renderOrder.push({ type: "loop_end", name: target });
		} else if (graph.nodes[target]) {
			renderOrder.push({ type: "node", name: target });
			renderedNodes.add(target);
		}

		// Follow edges
		const outbound = graph.edges.filter(e => e.from === target);
		const next = outbound[0]?.to;
		target = next;
	}

	// Add any nodes not yet rendered
	for (const name of nodeNames) {
		if (!renderedNodes.has(name)) {
			renderOrder.push({ type: "node", name });
		}
	}

	// ── Horizontal pipeline layout ──────────────────────────────────────────
	// Calculate cards per row based on terminal width (agent-chain.ts pattern)
	const arrowWidth = 5; // " ──▶ "
	const minCardWidth = 24;
	const maxCardsPerRow = Math.max(1, Math.floor((width + arrowWidth) / (minCardWidth + arrowWidth)));

	// Group renderOrder into sections: sequences of nodes, or loop blocks
	type Section =
		| { kind: "nodes"; names: string[] }
		| { kind: "loop"; loopName: string; nodeNames: string[] };
	const sections: Section[] = [];
	let currentNodes: string[] = [];

	for (const item of renderOrder) {
		if (item.type === "node") {
			currentNodes.push(item.name);
		} else if (item.type === "loop_start") {
			if (currentNodes.length > 0) {
				sections.push({ kind: "nodes", names: currentNodes });
				currentNodes = [];
			}
			// Collect loop nodes until loop_end
		} else if (item.type === "loop_end") {
			// Find the loop's nodes from renderOrder
			const loopNodes: string[] = [];
			// Walk back to find matching loop_start
			for (const inner of renderOrder) {
				if (inner.type === "loop_start" && inner.name === item.name) {
					// Start collecting
					continue;
				}
				if (inner.type === "node" && loopMembership[inner.name] === item.name) {
					loopNodes.push(inner.name);
				}
			}
			sections.push({ kind: "loop", loopName: item.name, nodeNames: loopNodes });
		}
	}
	if (currentNodes.length > 0) {
		sections.push({ kind: "nodes", names: currentNodes });
	}

	/** Render a row of cards horizontally with ──▶ arrows between them */
	function renderCardRow(names: string[], availWidth: number): string[] {
		const cols = Math.min(maxCardsPerRow, names.length);
		const totalArrowWidth = arrowWidth * (cols - 1);
		const colWidth = Math.max(minCardWidth, Math.floor((availWidth - totalArrowWidth) / cols));
		const arrowRow = 2; // middle of 5-line card (0-indexed)
		const rowLines: string[] = [];

		// Process in chunks of `cols`
		for (let chunk = 0; chunk < names.length; chunk += cols) {
			const rowNames = names.slice(chunk, chunk + cols);
			const cards = rowNames.map(n => {
				const ns = state.nodeStates[n] || { status: "idle" as const };
				return renderCard(n, ns, colWidth, theme);
			});

			// Pad incomplete rows with blank cards
			while (cards.length < cols) {
				cards.push(Array(5).fill(" ".repeat(colWidth)));
			}

			const cardHeight = cards[0].length;
			for (let line = 0; line < cardHeight; line++) {
				let row = cards[0][line];
				for (let c = 1; c < rowNames.length; c++) {
					if (line === arrowRow) {
						row += theme.fg("dim", " ──▶ ");
					} else {
						row += " ".repeat(arrowWidth);
					}
					row += cards[c][line];
				}
				rowLines.push(row);
			}

			// If there are more chunks, add a vertical arrow between rows
			if (chunk + cols < names.length) {
				rowLines.push(theme.fg("dim", "  ──▶"));
			}
		}
		return rowLines;
	}

	// Render each section
	let sectionIdx = 0;
	for (const section of sections) {
		if (section.kind === "nodes") {
			lines.push(...renderCardRow(section.names, width));
		} else {
			// Loop section — render inside a containing border
			const loopDef = graph.loops![section.loopName];
			const cycle = state.loopCycles[section.loopName] || 0;
			const maxC = loopDef.max_cycles;
			const loopLabel = loopDef.until ? "until loop" : "for_each loop";

			// Available inner width (2 for │ borders + 2 for padding)
			const innerWidth = width - 4;

			// Render inner cards horizontally
			const innerLines = renderCardRow(section.nodeNames, innerWidth);

			// Build the loop header
			const headerText = ` ${section.loopName} (${loopLabel}, cycle ${cycle}/${maxC}) `;
			const headerDash = Math.max(0, innerWidth - headerText.length);
			const topBorder = "┌─" + headerText + "─".repeat(headerDash) + "─┐";
			const botBorder = "└" + "─".repeat(innerWidth + 2) + "┘";

			lines.push(theme.fg("dim", topBorder));
			for (const il of innerLines) {
				lines.push(theme.fg("dim", "│ ") + il + theme.fg("dim", " │"));
			}
			lines.push(theme.fg("dim", botBorder));
		}

		// Arrow between sections
		sectionIdx++;
		if (sectionIdx < sections.length) {
			lines.push(theme.fg("dim", "  ──▶"));
		}
	}

	// Graph elapsed
	const totalElapsed = Math.round((Date.now() - state.startedAt) / 1000);
	const graphStatus = state.status === "running" ? theme.fg("accent", "● running") :
		state.status === "completed" ? theme.fg("success", "✓ completed") :
		state.status === "blocked" ? theme.fg("warning", "◼ blocked") :
		theme.fg("error", "✗ error");
	lines.push("");
	lines.push(graphStatus + theme.fg("dim", ` ${totalElapsed}s`));

	return lines;
}

// ── Phase 4: Extension Entry Point + Commands ───────────────────────────────

export default function (pi: ExtensionAPI) {
	let widgetCtx: ExtensionContext | null = null;
	let activeGraphState: GraphState | null = null;
	let activeGraph: GraphDef | null = null;
	let widgetTimer: ReturnType<typeof setInterval> | null = null;

	let isRunning = false;

	function updateWidget() {
		if (!widgetCtx || !activeGraphState || !activeGraph) return;

		widgetCtx.ui.setWidget("graph-engine", (_tui: any, theme: any) => {
			if (!Text) return { render: () => [], invalidate: () => {} };
			const text = new Text("", 0, 1);

			return {
				render(width: number): string[] {
					const lines = renderGraphWidget(activeGraphState!, activeGraph!, theme, width);
					text.setText(lines.join("\n"));
					return text.render(width);
				},
				invalidate() {
					text.invalidate();
				},
			};
		});
	}

	function clearWidget() {
		if (widgetTimer) {
			clearInterval(widgetTimer);
			widgetTimer = null;
		}
		if (widgetCtx) {
			widgetCtx.ui.setWidget("graph-engine", undefined);
		}
		activeGraphState = null;
		activeGraph = null;
	}

	// ── /run <graph-name> command ────────────────────────────────────────────

	pi.registerCommand("run", {
		description: "Execute a YAML graph: /run <graph-name> [input]",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const graphs = discoverGraphs();
			const items = graphs.map(g => ({
				value: g.file.replace(/\.ya?ml$/, ""),
				label: g.name,
				description: g.description,
			}));
			if (!prefix) return items;
			return items.filter(i => i.value.startsWith(prefix) || i.label.toLowerCase().startsWith(prefix.toLowerCase()));
		},
		handler: async (args, ctx) => {
			widgetCtx = ctx;

			if (isRunning) {
				ctx.ui.notify("A graph is already executing. Wait for it to finish.", "warning");
				return;
			}

			const parts = (args || "").trim().split(/\s+/);
			const graphName = parts[0];
			let input = parts.slice(1).join(" ");

			if (!graphName) {
				ctx.ui.notify("Usage: /run <graph-name> [input]", "error");
				return;
			}

			// Load graph file
			const yamlFile = join(GRAPHS_DIR, `${graphName}.yaml`);
			const ymlFile = join(GRAPHS_DIR, `${graphName}.yml`);
			const filePath = existsSync(yamlFile) ? yamlFile : existsSync(ymlFile) ? ymlFile : null;

			if (!filePath) {
				ctx.ui.notify(`Graph not found: "${graphName}". Run /graphs to see available graphs.`, "error");
				return;
			}

			// Parse
			let graph: GraphDef;
			try {
				const yamlContent = readFileSync(filePath, "utf-8");
				graph = parseGraph(yamlContent);
			} catch (err: any) {
				ctx.ui.notify(`Parse error: ${err.message}`, "error");
				return;
			}

			// Validate
			const validation = validateGraph(graph, __dirname_ge);
			if (!validation.valid) {
				const errMsg = validation.errors.join("\n");
				ctx.ui.notify(`Validation failed:\n${errMsg}`, "error");
				return;
			}

			// Prompt for input if not provided
			if (!input) {
				const prompted = await ctx.ui.input("Enter input for the graph");
				if (!prompted || !prompted.trim()) {
					ctx.ui.notify("No input provided, aborting.", "warning");
					return;
				}
				input = prompted.trim();
			}

			// Determine model from ctx
			const model = ctx.model
				? `${ctx.model.provider}/${ctx.model.id}`
				: undefined;

			// Initialize shared graph state for TUI widget (Task 4.6)
			const graphState: GraphState = {
				graphName: graph.name,
				status: "running",
				currentNode: null,
				currentLoop: null,
				loopCycles: {},
				nodeStates: {},
				outputs: {},
				input,
				startedAt: Date.now(),
			};

			// Initialize all node states
			for (const name of Object.keys(graph.nodes)) {
				graphState.nodeStates[name] = { status: "idle" };
			}

			// Set up widget and timer (Task 4.1 + 4.6)
			activeGraphState = graphState;
			activeGraph = graph;
			updateWidget();

			widgetTimer = setInterval(() => {
				updateWidget();
			}, 1000);

			// Execute graph
			isRunning = true;
			try {
				const result = await executeGraph(
					graph, input, __dirname_ge, ctx, pi, graphState, model,
				);

				// Update final state
				graphState.status = result.status === "completed" ? "completed" :
					result.status === "blocked" ? "blocked" : "error";
				graphState.completedAt = Date.now();
				updateWidget();

				// Display results via sendMessage (AC7)
				const resultLines: string[] = [];
				resultLines.push(`## Graph: ${graph.name}`);
				resultLines.push(`**Status:** ${result.status}`);
				resultLines.push(`**Elapsed:** ${(result.elapsedMs / 1000).toFixed(1)}s`);
				if (result.humanGateSelection) {
					resultLines.push(`**Human Gate:** ${result.humanGateSelection}`);
				}
				resultLines.push("");

				// Show outputs from each node
				for (const [nodeName, output] of Object.entries(result.outputs)) {
					if (nodeName.startsWith("__")) continue; // Skip internal keys
					resultLines.push(`### ${nodeName}`);
					resultLines.push("```json");
					resultLines.push(JSON.stringify(output, null, 2));
					resultLines.push("```");
					resultLines.push("");
				}

				if (result.error) {
					resultLines.push(`### Error`);
					resultLines.push(result.error);
				}

				pi.sendMessage(
					{
						customType: "graph-result",
						content: resultLines.join("\n"),
						display: true,
					},
					{ triggerTurn: false },
				);

			} catch (err: any) {
				graphState.status = "error";
				graphState.completedAt = Date.now();
				updateWidget();
				ctx.ui.notify(`Graph execution failed: ${err.message}`, "error");
			} finally {
				isRunning = false;
				// Stop timer after a delay so user sees final state, then clean up widget
				setTimeout(() => {
					clearWidget();
				}, 3000);
			}
		},
	});

	// ── /graphs command ──────────────────────────────────────────────────────

	pi.registerCommand("graphs", {
		description: "List available YAML graphs",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			const graphs = discoverGraphs();

			if (graphs.length === 0) {
				ctx.ui.notify("No graphs found in graphs/ directory.", "warning");
				return;
			}

			const lines = graphs.map(g => {
				const slug = g.file.replace(/\.ya?ml$/, "");
				return `  ${slug}  —  ${g.name}${g.description ? `: ${g.description}` : ""}`;
			});

			ctx.ui.notify(
				`Available graphs (${graphs.length}):\n${lines.join("\n")}`,
				"info",
			);
		},
	});

	// ── /validate <graph-name> command ───────────────────────────────────────

	pi.registerCommand("validate", {
		description: "Validate a YAML graph: /validate <graph-name>",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const graphs = discoverGraphs();
			const items = graphs.map(g => ({
				value: g.file.replace(/\.ya?ml$/, ""),
				label: g.name,
				description: g.description,
			}));
			if (!prefix) return items;
			return items.filter(i => i.value.startsWith(prefix) || i.label.toLowerCase().startsWith(prefix.toLowerCase()));
		},
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const graphName = (args || "").trim();

			if (!graphName) {
				ctx.ui.notify("Usage: /validate <graph-name>", "error");
				return;
			}

			const yamlFile = join(GRAPHS_DIR, `${graphName}.yaml`);
			const ymlFile = join(GRAPHS_DIR, `${graphName}.yml`);
			const filePath = existsSync(yamlFile) ? yamlFile : existsSync(ymlFile) ? ymlFile : null;

			if (!filePath) {
				ctx.ui.notify(`Graph not found: "${graphName}"`, "error");
				return;
			}

			let graph: GraphDef;
			try {
				const yamlContent = readFileSync(filePath, "utf-8");
				graph = parseGraph(yamlContent);
			} catch (err: any) {
				ctx.ui.notify(`Parse error: ${err.message}`, "error");
				return;
			}

			const validation = validateGraph(graph, __dirname_ge);

			if (validation.valid) {
				const nodeCount = Object.keys(graph.nodes).length;
				const loopCount = Object.keys(graph.loops || {}).length;
				const gateCount = (graph.human_gates || []).length;
				ctx.ui.notify(
					`Graph "${graph.name}" is valid\n` +
					`  Nodes: ${nodeCount}, Loops: ${loopCount}, Gates: ${gateCount}`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`Validation failed (${validation.errors.length} errors):\n` +
					validation.errors.map(e => `  - ${e}`).join("\n"),
					"error",
				);
			}

			if (validation.warnings.length > 0) {
				ctx.ui.notify(
					`Warnings:\n` + validation.warnings.map(w => `  - ${w}`).join("\n"),
					"warning",
				);
			}
		},
	});

	// ── Session Start ────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		widgetCtx = ctx;

		// Clean slate: clear stale widget from previous session
		clearWidget();

		// Load pi-tui modules (only succeeds inside Pi runtime)
		await loadTuiModules();

		// Discover graphs
		const graphs = discoverGraphs();
		const graphList = graphs.length > 0
			? graphs.map(g => `  ${g.file.replace(/\.ya?ml$/, "")}`).join("\n")
			: "  (none found)";

		ctx.ui.setStatus("graph-engine", "Graph Engine ready");
		ctx.ui.notify(
			`Graph Engine loaded\n\n` +
			`Commands:\n` +
			`  /run <graph-name> [input]  — Execute a graph\n` +
			`  /graphs                    — List available graphs\n` +
			`  /validate <graph-name>     — Validate a graph\n\n` +
			`Discovered graphs:\n${graphList}`,
			"info",
		);
	});
}
