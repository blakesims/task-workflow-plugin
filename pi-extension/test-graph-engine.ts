/**
 * Phase 1 verification script for graph-engine.ts
 * Run with: npx tsx --paths test-graph-engine.ts
 * Or with node pointing to the right yaml module.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseGraph, validateGraph, resolveTemplate, evaluateCondition, findNextTarget } from "./graph-engine.js";
import type { TemplateContext, EdgeDef } from "./graph-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
	if (condition) {
		console.log(`  PASS: ${label}`);
		passed++;
	} else {
		console.log(`  FAIL: ${label}`);
		failed++;
	}
}

// ── AC1: parseGraph() can parse investigation-grinder YAML ──────────────────

console.log("\n== AC1: parseGraph() ==");

const yamlContent = readFileSync(join(__dirname, "graphs/investigation-grinder.yaml"), "utf-8");
const graph = parseGraph(yamlContent);

assert(graph.name === "investigation-grinder", "graph.name === 'investigation-grinder'");
assert(typeof graph.description === "string" && graph.description.length > 0, "graph.description is non-empty");
assert("investigator" in graph.nodes, "nodes contains 'investigator'");
assert("reviewer" in graph.nodes, "nodes contains 'reviewer'");
assert(graph.nodes.investigator.persona === "personas/investigator.md", "investigator persona path");
assert(graph.nodes.investigator.schema === "schemas/investigator.json", "investigator schema path");
assert(graph.nodes.investigator.tools === "read,bash,grep", "investigator tools");
assert(graph.nodes.reviewer.persona === "personas/reviewer.md", "reviewer persona path");
assert(graph.edges.length >= 2, "at least 2 edges");
assert(graph.edges[0].from === "START", "first edge from START");
assert(graph.loops !== undefined, "loops defined");
assert(graph.loops!["investigation_loop"] !== undefined, "investigation_loop exists");
assert(graph.loops!["investigation_loop"].until === "reviewer.output.decision === 'PASS'", "until condition");
assert(graph.loops!["investigation_loop"].max_cycles === 3, "max_cycles === 3");
assert(graph.loops!["investigation_loop"].nodes.length === 2, "loop has 2 nodes");
assert(graph.human_gates !== undefined && graph.human_gates.length === 1, "1 human gate");
assert(graph.human_gates![0].options.length === 3, "3 gate options");

// ── AC2: validateGraph() returns success ─────────────────────────────────────

console.log("\n== AC2: validateGraph() success ==");

const result = validateGraph(graph, __dirname);
assert(result.valid === true, `valid === true (errors: ${result.errors.join("; ")})`);
assert(result.errors.length === 0, `no errors (got ${result.errors.length})`);

// ── AC3: validateGraph() returns specific errors ─────────────────────────────

console.log("\n== AC3: validateGraph() error cases ==");

// Test: missing files
const graphMissingFiles = parseGraph(yamlContent);
graphMissingFiles.nodes.investigator.persona = "personas/nonexistent.md";
const r1 = validateGraph(graphMissingFiles, __dirname);
assert(!r1.valid, "invalid when persona file missing");
assert(r1.errors.some((e) => e.includes("persona file not found")), "error mentions missing persona");

// Test: unreferenced node
const graphExtraNode = parseGraph(yamlContent);
graphExtraNode.nodes["orphan"] = {
	persona: "personas/investigator.md",
	schema: "schemas/investigator.json",
	prompt: "test",
};
const r2 = validateGraph(graphExtraNode, __dirname);
assert(!r2.valid, "invalid when node is unreachable");
assert(r2.errors.some((e) => e.includes("orphan") && e.includes("not reachable")), "error mentions orphan node");

// Test: template references non-existent node
const graphBadTemplate = parseGraph(yamlContent);
graphBadTemplate.nodes.investigator.prompt = "Check {{nonexistent.output.field}} please";
const r3 = validateGraph(graphBadTemplate, __dirname);
assert(!r3.valid, "invalid when template references non-existent node");
assert(r3.errors.some((e) => e.includes("nonexistent")), "error mentions non-existent node in template");

// Test: deep dot-path template references validated
console.log("\n== AC3: Deep dot-path template validation ==");
const graphDeepPath = parseGraph(yamlContent);
graphDeepPath.human_gates![0].display = ["{{bogus.output.deep.nested.path}}"];
const r4 = validateGraph(graphDeepPath, __dirname);
assert(!r4.valid, "invalid when deep dot-path references non-existent node");
assert(r4.errors.some((e) => e.includes("bogus")), "error mentions bogus node in deep dot-path");

// Test: valid deep dot-path passes (investigation-grinder uses them in human_gates)
const graphValidDeep = parseGraph(yamlContent);
const r4b = validateGraph(graphValidDeep, __dirname);
assert(r4b.valid, `valid deep dot-paths accepted (errors: ${r4b.errors.join("; ")})`);

// Test: {{#if}} conditional references validated
console.log("\n== AC3: {{#if}} conditional validation ==");
const graphBadIf = parseGraph(yamlContent);
graphBadIf.nodes.investigator.prompt = "{{#if phantom.output.field}}show{{/if}}";
const r5 = validateGraph(graphBadIf, __dirname);
assert(!r5.valid, "invalid when {{#if}} references non-existent node");
assert(r5.errors.some((e) => e.includes("phantom") && e.includes("conditional")), "error mentions phantom node in conditional");

// Test: valid {{#if}} passes (investigator prompt uses {{#if reviewer.output...}})
const graphValidIf = parseGraph(yamlContent);
const r5b = validateGraph(graphValidIf, __dirname);
assert(r5b.valid, `valid {{#if}} references accepted (errors: ${r5b.errors.join("; ")})`);

// Test: loop mutual exclusivity — both until and for_each
console.log("\n== AC3: Loop mutual exclusivity ==");
const graphBothLoop = parseGraph(yamlContent);
graphBothLoop.loops!["investigation_loop"].for_each = "investigator.output.items";
const r6 = validateGraph(graphBothLoop, __dirname);
assert(!r6.valid, "invalid when loop has both until and for_each");
assert(r6.errors.some((e) => e.includes("both")), "error mentions both until and for_each");

// Test: loop with neither until nor for_each
const graphNoLoop = parseGraph(yamlContent);
delete graphNoLoop.loops!["investigation_loop"].until;
const r7 = validateGraph(graphNoLoop, __dirname);
assert(!r7.valid, "invalid when loop has neither until nor for_each");
assert(r7.errors.some((e) => e.includes("neither")), "error mentions neither until nor for_each");

// Test: on_max with invalid value
console.log("\n== AC3: on_max validation ==");
const graphBadOnMax = parseGraph(yamlContent);
graphBadOnMax.loops!["investigation_loop"].on_max = "TYPOSTATE";
const r8 = validateGraph(graphBadOnMax, __dirname);
assert(!r8.valid, "invalid when on_max is not a known terminal or node");
assert(r8.errors.some((e) => e.includes("TYPOSTATE")), "error mentions invalid on_max value");

// Test: HUMAN_GATE edge without matching gate definition
console.log("\n== AC3: HUMAN_GATE edge correlation ==");
const graphNoGate = parseGraph(yamlContent);
graphNoGate.human_gates = [];
const r9 = validateGraph(graphNoGate, __dirname);
assert(!r9.valid, "invalid when HUMAN_GATE edge has no matching gate definition");
assert(r9.errors.some((e) => e.includes("no corresponding human gate")), "error mentions missing gate definition");

// Test: YAML syntax error
console.log("\n== Extra: YAML syntax error handling ==");
let caughtYamlError = false;
try {
	parseGraph("invalid: yaml: [unterminated");
} catch (e: any) {
	caughtYamlError = e.message.includes("YAML syntax error");
}
assert(caughtYamlError, "parseGraph throws on malformed YAML");

// ── Phase 2 AC1: Basic input interpolation ──────────────────────────────────

console.log("\n== Phase 2 AC1: resolveTemplate basic ==");

assert(
	resolveTemplate("Investigate: {{input}}", { input: "memory leak" }) === "Investigate: memory leak",
	"{{input}} resolves to context.input",
);

assert(
	resolveTemplate("No vars here", {}) === "No vars here",
	"template without vars passes through unchanged",
);

assert(
	resolveTemplate("A {{input}} B {{input}} C", { input: "X" }) === "A X B X C",
	"multiple {{input}} occurrences replaced",
);

// ── Phase 2 AC2: Conditional blocks ─────────────────────────────────────────

console.log("\n== Phase 2 AC2: resolveTemplate conditionals ==");

assert(
	resolveTemplate("{{#if challenges}}Challenges: {{challenges}}{{/if}}", { challenges: "" }) === "",
	"empty string is falsy — conditional block removed",
);

assert(
	resolveTemplate("{{#if challenges}}Challenges: {{challenges}}{{/if}}", { challenges: "OOM" }) === "Challenges: OOM",
	"non-empty string is truthy — conditional block kept",
);

assert(
	resolveTemplate("before {{#if missing}}hidden{{/if}} after", {}) === "before  after",
	"undefined variable is falsy — conditional block removed",
);

assert(
	resolveTemplate("{{#if items}}has items{{/if}}", { items: [] as any }) === "",
	"empty array is falsy — conditional block removed",
);

// ── Phase 2 AC3: Dot-path traversal through nested outputs ──────────────────

console.log("\n== Phase 2 AC3: resolveTemplate dot-path ==");

const dotPathContext: TemplateContext = {
	input: "test",
	outputs: {
		reviewer: {
			decision: "PASS",
			human_executive_summary: {
				bottom_line: "All clear",
			},
		},
	},
};

assert(
	resolveTemplate("{{reviewer.output.decision}}", dotPathContext) === "PASS",
	"{{reviewer.output.decision}} resolves via outputs.reviewer.decision",
);

assert(
	resolveTemplate("{{reviewer.output.human_executive_summary.bottom_line}}", dotPathContext) === "All clear",
	"deep dot-path: reviewer.output.human_executive_summary.bottom_line",
);

// Full output (object) should be JSON.stringified
const fullOutput = resolveTemplate("{{reviewer.output}}", dotPathContext);
assert(
	fullOutput.includes('"decision":"PASS"') || fullOutput.includes('"decision": "PASS"'),
	"{{reviewer.output}} returns JSON stringified full output",
);

// Missing node output returns empty string
assert(
	resolveTemplate("{{nonexistent.output.field}}", dotPathContext) === "",
	"missing node output resolves to empty string",
);

// ── Phase 2: Loop variable interpolation ────────────────────────────────────

console.log("\n== Phase 2: Loop variable resolution ==");

const loopContext: TemplateContext = {
	input: "test",
	outputs: {},
	loopVars: { current_phase: "Phase 1: Setup" },
};

assert(
	resolveTemplate("Working on: {{current_phase}}", loopContext) === "Working on: Phase 1: Setup",
	"{{loop_var}} resolves from loopVars",
);

// ── Phase 2: Conditional with dot-path ──────────────────────────────────────

console.log("\n== Phase 2: Conditional with dot-path ==");

assert(
	resolveTemplate("{{#if reviewer.output.decision}}Decision: {{reviewer.output.decision}}{{/if}}", dotPathContext) === "Decision: PASS",
	"{{#if node.output.field}} works with truthy dot-path",
);

const emptyOutputCtx: TemplateContext = {
	outputs: { reviewer: { decision: "" } },
};

assert(
	resolveTemplate("{{#if reviewer.output.decision}}Decision: {{reviewer.output.decision}}{{/if}}", emptyOutputCtx) === "",
	"{{#if node.output.field}} with empty string is falsy",
);

// ── Phase 3 AC5: Safe condition evaluator (no eval()) ──────────────────────

console.log("\n== Phase 3 AC5: evaluateCondition ==");

// String equality
{
	const outputs = { reviewer: { decision: "PASS" } };
	const r = evaluateCondition("reviewer.output.decision === 'PASS'", outputs);
	assert(r.result === true, "=== 'PASS' matches when decision is PASS");
	assert(r.warning === undefined, "no warning for valid condition");
}

{
	const outputs = { reviewer: { decision: "REVISE" } };
	const r = evaluateCondition("reviewer.output.decision === 'PASS'", outputs);
	assert(r.result === false, "=== 'PASS' fails when decision is REVISE");
}

// String inequality
{
	const outputs = { reviewer: { decision: "REVISE" } };
	const r = evaluateCondition("reviewer.output.decision !== 'PASS'", outputs);
	assert(r.result === true, "!== 'PASS' matches when decision is REVISE");
}

// Numeric comparisons
{
	const outputs = { analyzer: { score: 85 } };
	assert(evaluateCondition("analyzer.output.score > 50", outputs).result === true, "> 50 when score=85");
	assert(evaluateCondition("analyzer.output.score < 90", outputs).result === true, "< 90 when score=85");
	assert(evaluateCondition("analyzer.output.score >= 85", outputs).result === true, ">= 85 when score=85");
	assert(evaluateCondition("analyzer.output.score <= 85", outputs).result === true, "<= 85 when score=85");
	assert(evaluateCondition("analyzer.output.score > 90", outputs).result === false, "> 90 fails when score=85");
}

// Boolean value
{
	const outputs = { checker: { passed: true } };
	assert(evaluateCondition("checker.output.passed === true", outputs).result === true, "=== true");
}

// Missing node returns false (no crash)
{
	const outputs = {};
	const r = evaluateCondition("missing.output.field === 'value'", outputs);
	assert(r.result === false, "missing node returns false");
}

// Deep dot-path
{
	const outputs = { reviewer: { summary: { status: "ok" } } };
	const r = evaluateCondition("reviewer.output.summary.status === 'ok'", outputs);
	assert(r.result === true, "deep dot-path condition works");
}

// Unparseable condition: fallback to false with warning (plan review minor #4)
{
	const r = evaluateCondition("this is not a condition", {});
	assert(r.result === false, "unparseable condition returns false");
	assert(r.warning !== undefined && r.warning.includes("Unparseable"), "unparseable condition has warning");
}

// Unparseable value (node exists so value parsing is reached)
{
	const outputs = { node: { field: "x" } };
	const r = evaluateCondition("node.output.field === someUndefined", outputs);
	assert(r.result === false, "non-numeric non-string value returns false");
	assert(r.warning !== undefined, "unparseable value has warning");
}

// Double-quoted strings
{
	const outputs = { reviewer: { decision: "PASS" } };
	const r = evaluateCondition('reviewer.output.decision === "PASS"', outputs);
	assert(r.result === true, 'double-quoted string "PASS" works');
}

// ── Phase 3: Edge following ─────────────────────────────────────────────────

console.log("\n== Phase 3: findNextTarget ==");

// Basic edge following
{
	const edges: EdgeDef[] = [
		{ from: "START", to: "investigator" },
		{ from: "investigator", to: "reviewer" },
		{ from: "reviewer", to: "DONE" },
	];
	const r = findNextTarget("investigator", edges, {});
	assert(r.target === "reviewer", "follows basic edge from investigator to reviewer");
}

// No outbound edge defaults to DONE with warning
{
	const edges: EdgeDef[] = [{ from: "START", to: "a" }];
	const r = findNextTarget("orphan", edges, {});
	assert(r.target === "DONE", "no outbound edge defaults to DONE");
	assert(r.warning !== undefined, "missing edge produces warning");
}

// Conditional edges: first match wins
{
	const edges: EdgeDef[] = [
		{ from: "reviewer", to: "investigator", when: "reviewer.output.decision === 'REVISE'" },
		{ from: "reviewer", to: "DONE", when: "reviewer.output.decision === 'PASS'" },
		{ from: "reviewer", to: "BLOCKED" }, // default fallback
	];
	const outputs = { reviewer: { decision: "PASS" } };
	const r = findNextTarget("reviewer", edges, outputs);
	assert(r.target === "DONE", "conditional edge matches PASS -> DONE");
}

{
	const edges: EdgeDef[] = [
		{ from: "reviewer", to: "investigator", when: "reviewer.output.decision === 'REVISE'" },
		{ from: "reviewer", to: "DONE", when: "reviewer.output.decision === 'PASS'" },
		{ from: "reviewer", to: "BLOCKED" }, // default fallback
	];
	const outputs = { reviewer: { decision: "REVISE" } };
	const r = findNextTarget("reviewer", edges, outputs);
	assert(r.target === "investigator", "conditional edge matches REVISE -> investigator");
}

// No conditional match falls through to default
{
	const edges: EdgeDef[] = [
		{ from: "reviewer", to: "DONE", when: "reviewer.output.decision === 'PASS'" },
		{ from: "reviewer", to: "BLOCKED" }, // default fallback
	];
	const outputs = { reviewer: { decision: "UNKNOWN" } };
	const r = findNextTarget("reviewer", edges, outputs);
	assert(r.target === "BLOCKED", "falls back to default edge when no condition matches");
}

// No conditional match and no default -> BLOCKED with warning
{
	const edges: EdgeDef[] = [
		{ from: "reviewer", to: "DONE", when: "reviewer.output.decision === 'PASS'" },
	];
	const outputs = { reviewer: { decision: "UNKNOWN" } };
	const r = findNextTarget("reviewer", edges, outputs);
	assert(r.target === "BLOCKED", "no match and no default -> BLOCKED");
	assert(r.warning !== undefined, "produces warning when no edge matches");
}

// ── Phase 3: false/0 truthy fix (Phase 2 deferred major) ───────────────────

console.log("\n== Phase 3: false/0 truthy fix ==");

assert(
	resolveTemplate("{{#if val}}yes{{/if}}", { val: false as any }) === "",
	"false is falsy in {{#if}}",
);

assert(
	resolveTemplate("{{#if val}}yes{{/if}}", { val: 0 as any }) === "",
	"0 is falsy in {{#if}}",
);

assert(
	resolveTemplate("{{#if val}}yes{{/if}}", { val: 1 as any }) === "yes",
	"1 is still truthy in {{#if}}",
);

// ── Phase 3: Edge when field parsed from YAML ───────────────────────────────

console.log("\n== Phase 3: Edge when field in YAML ==");

const yamlWithWhen = `
name: test-conditional
description: test
nodes:
  a:
    persona: personas/investigator.md
    schema: schemas/investigator.json
    prompt: test
  b:
    persona: personas/investigator.md
    schema: schemas/investigator.json
    prompt: test
edges:
  - from: START
    to: a
  - from: a
    to: b
    when: "a.output.ready === 'yes'"
  - from: a
    to: DONE
  - from: b
    to: DONE
`;

const graphWhen = parseGraph(yamlWithWhen);
assert(graphWhen.edges[1].when === "a.output.ready === 'yes'", "when field parsed from YAML");
assert(graphWhen.edges[0].when === undefined, "edge without when has undefined");

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n== Results: ${passed} passed, ${failed} failed ==`);
process.exit(failed > 0 ? 1 : 0);
