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
): Promise<{ status: "completed" | "blocked" | "error"; warning?: string }> {
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
				const output = await spawnGraphNode(nodeDef, resolvedPrompt, baseDir);

				state.outputs[nodeName] = output;
				state.nodeStates[nodeName] = {
					status: "done",
					output,
					startedAt: state.nodeStates[nodeName].startedAt,
					completedAt: Date.now(),
				};
			} catch (err: any) {
				state.nodeStates[nodeName] = {
					status: "error",
					error: err.message,
					startedAt: state.nodeStates[nodeName].startedAt,
					completedAt: Date.now(),
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
	return { status: "completed" }; // DONE or a node name — let the caller handle routing
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
				const output = await spawnGraphNode(nodeDef, resolvedPrompt, baseDir);

				// Store both overwriting and indexed
				state.outputs[nodeName] = output;
				state.outputs[`${nodeName}_${i}`] = output;
				state.nodeStates[nodeName] = {
					status: "done",
					output,
					startedAt: state.nodeStates[nodeName].startedAt,
					completedAt: Date.now(),
				};
			} catch (err: any) {
				state.nodeStates[nodeName] = {
					status: "error",
					error: err.message,
					startedAt: state.nodeStates[nodeName].startedAt,
					completedAt: Date.now(),
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
): Promise<GraphResult> {
	const startTime = Date.now();

	// Initialize graph state
	const state: GraphState = {
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

	// Initialize all node states to idle
	for (const name of Object.keys(graph.nodes)) {
		state.nodeStates[name] = { status: "idle" };
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

				let loopResult: { status: string; warning?: string };

				if (loopDef.until) {
					loopResult = await executeUntilLoop(
						loopName, loopDef, graph, state, baseDir, ctx,
					);
				} else if (loopDef.for_each) {
					loopResult = await executeForEachLoop(
						loopName, loopDef, graph, state, baseDir, ctx,
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

				// Loop completed — follow outbound edge
				const { target, warning } = findNextTarget(loopName, graph.edges, state.outputs);
				if (warning) ctx.ui.notify(warning, "warning");
				currentTarget = target;

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

				const templateContext: TemplateContext = {
					input: state.input,
					outputs: state.outputs,
				};

				const resolvedPrompt = resolveTemplate(nodeDef.prompt, templateContext);
				const output = await spawnGraphNode(nodeDef, resolvedPrompt, baseDir);

				state.outputs[nodeName] = output;
				state.nodeStates[nodeName] = {
					status: "done",
					output,
					startedAt: state.nodeStates[nodeName].startedAt,
					completedAt: Date.now(),
				};

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

// ── Extension Entry Point (Phase 4 — placeholder) ──────────────────────────

export default function (pi: ExtensionAPI) {
	// Commands will be registered in Phase 4
}
