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
