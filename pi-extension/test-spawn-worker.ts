/**
 * Manual AC4 test: spawn a real worker via spawnGraphNode().
 * Requires a live LLM — run manually, not in CI.
 *
 * Usage: npx tsx pi-extension/test-spawn-worker.ts
 */
import { writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnGraphNode } from "./graph-engine.js";
import type { NodeDef } from "./graph-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = join(__dirname, "_test_tmp");

// Setup: create minimal persona + schema files
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

writeFileSync(join(tmpDir, "math-persona.md"), "You are a math assistant. Answer concisely.");
writeFileSync(
	join(tmpDir, "math-schema.json"),
	JSON.stringify({
		type: "object",
		properties: {
			answer: { type: "string", description: "The answer to the math question." },
		},
		required: ["answer"],
	}),
);

const nodeDef: NodeDef = {
	persona: "math-persona.md",
	schema: "math-schema.json",
	prompt: "What is 2+2?",
};

console.log("Spawning worker with math question...");

(async () => {
	const startTime = Date.now();
	try {
		const result = await spawnGraphNode(nodeDef, "What is 2+2?", tmpDir);
		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
		console.log(`\nWorker returned in ${elapsed}s:`);
		console.log(JSON.stringify(result, null, 2));

		if (result && typeof result.answer === "string" && result.answer.length > 0) {
			console.log("\nPASS: spawnGraphNode returned structured JSON with answer field");
		} else {
			console.log("\nFAIL: unexpected result shape");
			process.exit(1);
		}
	} catch (err: any) {
		console.error(`\nFAIL: ${err.message}`);
		process.exit(1);
	} finally {
		// Cleanup
		rmSync(tmpDir, { recursive: true, force: true });
	}
})();
