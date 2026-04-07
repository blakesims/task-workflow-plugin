import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, writeFileSync } from "fs";

export default function (pi: ExtensionAPI) {
  const personaPath = process.env.PERSONA_PATH;
  const schemaPath = process.env.SCHEMA_PATH;
  const resultPath = process.env.RESULT_PATH;

  if (!personaPath || !schemaPath || !resultPath) {
    console.error("Missing required environment variables for worker:");
    if (!personaPath) console.error("- PERSONA_PATH");
    if (!schemaPath) console.error("- SCHEMA_PATH");
    if (!resultPath) console.error("- RESULT_PATH");
    process.exit(1);
  }

  const persona = readFileSync(personaPath, "utf8");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

  // 1. Inject the Persona
  pi.on("before_agent_start", (event) => {
    return {
      systemPrompt: persona + "\n\nCRITICAL: You MUST use the `submit_results` tool to complete your task. Do not end your turn without calling it."
    };
  });

  // 2. Register the Terminal Tool dynamically
  pi.registerTool({
    name: "submit_results",
    description: "Submit your final structured results.",
    parameters: schema,
    async execute(id, params) {
      // 3. Save the perfect JSON payload and kill the process
      writeFileSync(resultPath, JSON.stringify(params, null, 2), "utf8");
      
      // Delay exit slightly so the tool execution cleanly registers in the Pi logs
      setTimeout(() => process.exit(0), 100);
      
      return { content: [{ type: "text", text: "Results submitted successfully. Terminating." }] };
    }
  });
}