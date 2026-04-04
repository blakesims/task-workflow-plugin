import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Generic headless worker for graph machine nodes.
 *
 * Reads config from environment variables:
 *   WORKER_SYSTEM_PROMPT - The persona/instructions
 *   WORKER_TOOL_NAME     - Name of the terminal tool to register
 *   WORKER_TOOL_DESC     - Description for the LLM
 *   WORKER_SCHEMA        - JSON string of the tool's parameter schema
 *
 * The LLM's only available action is calling this tool.
 * The parent orchestrator reads the tool args from the JSONL stream.
 */
export default function (pi: ExtensionAPI) {
	const systemPrompt = process.env.WORKER_SYSTEM_PROMPT;
	const toolName = process.env.WORKER_TOOL_NAME || "submit_results";
	const toolDesc = process.env.WORKER_TOOL_DESC || "Submit your results.";
	const schemaJson = process.env.WORKER_SCHEMA;

	if (!systemPrompt || !schemaJson) {
		console.error("WORKER_ERROR: Missing WORKER_SYSTEM_PROMPT or WORKER_SCHEMA");
		process.exit(1);
	}

	const schema = JSON.parse(schemaJson);

	pi.registerTool({
		name: toolName,
		label: toolName,
		description: toolDesc,
		parameters: schema,
		async execute(_id, params) {
			return { content: [{ type: "text", text: "Submitted." }] };
		},
	});

	pi.on("before_agent_start", () => {
		return {
			systemPrompt:
				systemPrompt +
				`\n\nCRITICAL: You MUST call the \`${toolName}\` tool to complete your task. Do not respond with plain text. Only call the tool.`,
		};
	});
}
