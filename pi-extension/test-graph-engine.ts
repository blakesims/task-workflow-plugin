/**
 * Phase 1 verification script for graph-engine.ts
 * Run with: npx tsx --paths test-graph-engine.ts
 * Or with node pointing to the right yaml module.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseGraph, validateGraph } from "./graph-engine.js";

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

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n== Results: ${passed} passed, ${failed} failed ==`);
process.exit(failed > 0 ? 1 : 0);
