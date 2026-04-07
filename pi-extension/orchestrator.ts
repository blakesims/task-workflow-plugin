import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

export default function (pi: ExtensionAPI) {
  
  // MVP TEST COMMAND
  pi.registerCommand("test-graph", {
    description: "Run the MVP Investigator -> Reviewer -> Human Gate loop on a mock issue.",
    handler: async (_args, ctx) => {
      
      const mockIssue = {
        id: "L999",
        summary: "Database connection timeouts on the reporting dashboard",
        details: "Sentry shows 50+ errors in the last hour. Mostly occurring on the /reports endpoint."
      };

      ctx.ui.setWidget("grinder-status", [
        `⚙️ MVP GRAPH MACHINE ACTIVE`,
        `📄 Current: ${mockIssue.id} - ${mockIssue.summary}`
      ]);

      try {
        // Node 1: Investigator
        ctx.ui.setStatus("grinder", `Investigating ${mockIssue.id}...`);
        const invPayload = await spawnSchemaWorker(ctx, pi, "investigator", {
          issue: mockIssue,
          task: "Review the issue details and output your structured findings."
        });

        // Node 2: Reviewer
        ctx.ui.setStatus("grinder", `Reviewing investigation...`);
        const revPayload = await spawnSchemaWorker(ctx, pi, "reviewer", {
          issue: mockIssue,
          investigator_findings: invPayload,
          task: "Critique the investigator's findings and output your gate decision."
        });

        ctx.ui.setStatus("grinder", undefined);

        // Node 3: The Human Gate
        const summary = revPayload.human_executive_summary;
        const promptText = `Investigation Complete for ${mockIssue.id}\n\n` +
          `Investigator Found: ${invPayload.root_cause_summary}\n\n` +
          `Reviewer Bottom Line: ${summary.bottom_line}\n` +
          `Proof Verified: ${summary.proof_verified ? "Yes" : "No"}\n` +
          `Risks/Gaps: ${summary.risks_or_gaps.join(", ")}\n\n` +
          `Recommendation: ${summary.recommended_action}`;

        await ctx.ui.select(
          promptText,
          ["Create Task Workflow", "Mark as WontFix", "Skip for now"]
        );

        ctx.ui.notify("MVP Graph Machine Test Complete!", "success");

      } catch (e: any) {
        ctx.ui.notify(`Graph Machine Error: ${e.message}`, "error");
      } finally {
        ctx.ui.setWidget("grinder-status", undefined);
        ctx.ui.setStatus("grinder", undefined);
      }
    }
  });
}

/**
 * Spawns a subagent driven by a Persona and constrained by a Terminal Tool schema.
 */
async function spawnSchemaWorker(ctx: ExtensionContext, pi: ExtensionAPI, role: "investigator" | "reviewer", contextPayload: any) {
  const personaPath = join(__dirname, "personas", `${role}.md`);
  const schemaPath = join(__dirname, "schemas", `${role}.json`);
  const workerTs = join(__dirname, "worker.ts");
  
  // Generate a temporary file path for the IPC payload
  const resultPath = join("/tmp", `worker_result_${Date.now()}_${Math.random().toString(36).substring(7)}.json`);
  const promptString = JSON.stringify(contextPayload, null, 2);

  const env = {
    ...process.env,
    PERSONA_PATH: personaPath,
    SCHEMA_PATH: schemaPath,
    RESULT_PATH: resultPath,
    WORKER_PROMPT: promptString,
    // Use Haiku to keep the testing fast and cheap
    PI_MODEL: "anthropic:claude-3-5-haiku-latest" 
  };

  ctx.ui.setWorkingMessage(`Spawning headless ${role} worker...`);

  const procResult = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const { spawn } = require("child_process");
    const child = spawn("pi", ["-p", "--no-tools", "-e", workerTs, promptString], { env });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: any) => { stdout += data.toString(); });
    child.stderr.on("data", (data: any) => { stderr += data.toString(); });

    child.on("close", (code: number) => {
      resolve({ code, stdout, stderr });
    });

    child.on("error", (err: Error) => {
      reject(err);
    });

    // Timeout
    setTimeout(() => {
      child.kill();
      reject(new Error(`Timeout after 60s. Stdout: ${stdout}`));
    }, 60000);
  });

  ctx.ui.setWorkingMessage(); // Clear working message

  if (!existsSync(resultPath)) {
    // If it failed, log the stderr to help us debug exactly why the LLM didn't call the tool
    throw new Error(`${role} worker failed. Exit code: ${procResult.code}\nStdout: ${procResult.stdout}\nStderr: ${procResult.stderr}`);
  }

  const data = JSON.parse(readFileSync(resultPath, "utf8"));
  unlinkSync(resultPath); // Cleanup
  return data;
}