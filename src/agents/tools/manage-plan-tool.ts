import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { resolveAgentDir } from "../agent-scope.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import type { AnyAgentTool } from "./common.js";
import { stringEnum } from "../schema/typebox.js";

const ManagePlanToolSchema = Type.Object({
  summary: Type.String({ description: "A summary of the overall objective." }),
  tasks: Type.Array(
    Type.Object({
      id: Type.String({ description: "A unique identifier for the task, e.g. 'setup_db'." }),
      title: Type.String({ description: "A human-readable title for the task." }),
      status: stringEnum(["todo", "in_progress", "done"], {
        description: "Current status of the task.",
      }),
    }),
    { description: "List of tasks in the plan." }
  )
});

export function createManagePlanTool(opts?: {
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Manage Plan",
    name: "manage_plan",
    description: "Create or update the agent's active plan and todo list. Use this to break down complex objectives and track your progress.",
    parameters: ManagePlanToolSchema,
    execute: async (_toolCallId, args) => {
      const { summary, tasks } = args as {
        summary: string;
        tasks: Array<{ id: string; title: string; status: "todo" | "in_progress" | "done" }>;
      };

      const cfg = loadConfig();
      const agentId = resolveAgentIdFromSessionKey(opts?.agentSessionKey);
      const agentDir = resolveAgentDir(cfg, agentId);

      // Ensure agentDir exists
      await fs.promises.mkdir(agentDir, { recursive: true });

      const planPath = path.join(agentDir, "plan.json");
      const planData = {
        summary,
        tasks,
        updatedAt: new Date().toISOString()
      };

      await fs.promises.writeFile(planPath, JSON.stringify(planData, null, 2), "utf-8");

      return {
        content: [{ type: "text", text: `Plan updated successfully with ${tasks.length} tasks.` }],
        details: { ok: true, planPath }
      };
    }
  };
}
