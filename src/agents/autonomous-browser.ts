import { complete, getModel, type Context, type ToolResultMessage, type Model } from "@mariozechner/pi-ai";
import { loadConfig } from "../config/config.js";
import { resolveDefaultModelForAgent } from "./model-selection.js";
import { createBrowserTool } from "./tools/browser-tool.js";
import { createManagePlanTool } from "./tools/manage-plan-tool.js";
import { createWebSearchTool, createWebFetchTool } from "./tools/web-tools.js";
import { getEnvApiKey } from "@mariozechner/pi-ai";
import { BROWSER_AGENT_HINT } from "./prompts/browser-agent-hint.js";
import type { AnyAgentTool } from "./tools/common.js";
import fs from "node:fs/promises";
import path from "node:path";

export type AutonomousBrowserTask = {
  query: string;
  targetUrl?: string;
  allowedDomains?: string[];
  maxTabs?: number;
  maxDepth?: number;
  maxSteps?: number;
  timeoutMs?: number;
  requiresVision?: boolean;
};

type BrowserMemory = {
  summary: string;
  data: unknown;
};

type PlanTask = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
};

const DEFAULT_MAX_STEPS = 20;
const MAX_STEPS_HARD_LIMIT = 40;
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
const TOOL_CALLS_PER_TURN_LIMIT = 4;
const UNSAFE_PROTOCOLS = new Set([
  "javascript:",
  "data:",
  "file:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
]);

export function isSafeBrowserUrl(urlValue: string): boolean {
  const trimmed = urlValue.trim();
  if (!trimmed) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (UNSAFE_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export function isDomainAllowed(urlValue: string, allowlist?: readonly string[]): boolean {
  if (!allowlist?.length) {
    return true;
  }
  let hostname: string;
  try {
    hostname = new URL(urlValue).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    const domain = entry.trim().toLowerCase().replace(/^\./, "");
    if (!domain) {
      return false;
    }
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
}

export function extractFinalAnswerText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const prefixes = ["FINAL:", "FINAL_ANSWER:", "Final answer:"];
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
}

export class AutonomousBrowser {
  private config = loadConfig();
  private memoryCache = new Map<string, BrowserMemory>();

  constructor(private options: {
    sessionKey: string;
    onProgress?: (msg: string) => void;
  }) {}

  private async getNeonClient() {
    const dbUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
    if (dbUrl && dbUrl.includes("neon.tech")) {
      try {
        const pg = (await import("pg")) as typeof import("pg");
        const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: true } });
        await client.connect();
        await client.query(`
          CREATE TABLE IF NOT EXISTS browser_memory (
            id SERIAL PRIMARY KEY,
            url TEXT UNIQUE,
            summary TEXT,
            extracted_data JSONB,
            visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        return client;
      } catch (e) {
        console.error("Failed to connect to Neon:", e);
        return null;
      }
    }
    return null;
  }

  private async storeMemory(url: string, summary: string, data: unknown) {
    this.memoryCache.set(url, { summary, data });
    
    // Try Neon first
    const neon = await this.getNeonClient();
    if (neon) {
      try {
        await neon.query(
          "INSERT INTO browser_memory (url, summary, extracted_data) VALUES ($1, $2, $3) ON CONFLICT (url) DO UPDATE SET summary = EXCLUDED.summary, extracted_data = EXCLUDED.extracted_data, visited_at = CURRENT_TIMESTAMP",
          [url, summary, JSON.stringify(data)]
        );
      } finally {
        await neon.end();
      }
      return;
    }

    // Fallback to local file memory
    try {
      const memoryDir = path.join(process.cwd(), "memory");
      await fs.mkdir(memoryDir, { recursive: true });
      const memFile = path.join(memoryDir, "browser-history.json");
      let history: Record<string, any> = {};
      try {
        const content = await fs.readFile(memFile, "utf-8");
        history = JSON.parse(content);
      } catch {}
      
      history[url] = { summary, data, visited_at: new Date().toISOString() };
      await fs.writeFile(memFile, JSON.stringify(history, null, 2));
    } catch (e) {
      console.error("Failed to write local browser memory:", e);
    }
  }

  private async checkMemory(url: string): Promise<BrowserMemory | null> {
    if (this.memoryCache.has(url)) return this.memoryCache.get(url);

    const neon = await this.getNeonClient();
    if (neon) {
      try {
        const res = await neon.query("SELECT summary, extracted_data FROM browser_memory WHERE url = $1", [url]);
        if (res.rows.length > 0) {
           return { summary: res.rows[0].summary, data: res.rows[0].extracted_data };
        }
      } finally {
        await neon.end();
      }
    } else {
       try {
         const memFile = path.join(process.cwd(), "memory", "browser-history.json");
         const content = await fs.readFile(memFile, "utf-8");
         const history = JSON.parse(content);
         if (history[url]) return history[url];
       } catch {}
    }
    return null;
  }

  private normalizeBoundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(value)));
  }

  private createPlanTasks(): PlanTask[] {
    return [
      { id: "plan", title: "Plan browsing strategy", status: "done" },
      { id: "navigate", title: "Navigate and gather evidence", status: "in_progress" },
      { id: "synthesize", title: "Synthesize findings", status: "todo" },
      { id: "final", title: "Return final answer", status: "todo" },
    ];
  }

  private async writePlan(summary: string, tasks: PlanTask[]): Promise<void> {
    try {
      const tool = createManagePlanTool({ agentSessionKey: this.options.sessionKey });
      await tool.execute("", { summary, tasks });
    } catch {
      // Plan persistence should not fail the browsing task.
    }
  }

  private readActionProgress(toolName: string, rawArgs: unknown): string {
    const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
    if (toolName === "browser") {
      const action = typeof args.action === "string" ? args.action : "action";
      const target =
        (typeof args.url === "string" && args.url) ||
        (typeof args.targetUrl === "string" && args.targetUrl) ||
        "";
      return target ? `browser:${action} ${target}` : `browser:${action}`;
    }
    if (toolName === "web_search") {
      return `web_search: ${(typeof args.query === "string" && args.query) || "query"}`;
    }
    if (toolName === "web_fetch") {
      return `web_fetch: ${(typeof args.url === "string" && args.url) || "current page"}`;
    }
    return toolName;
  }

  private readToolUrlCandidates(toolName: string, rawArgs: unknown): string[] {
    const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
    if (toolName === "browser") {
      const action = typeof args.action === "string" ? args.action : "";
      if (action === "navigate" || action === "open") {
        const url =
          (typeof args.url === "string" && args.url) ||
          (typeof args.targetUrl === "string" && args.targetUrl) ||
          "";
        return url ? [url] : [];
      }
      return [];
    }
    if (toolName === "web_fetch") {
      const url = typeof args.url === "string" ? args.url : "";
      return url && url !== "current" ? [url] : [];
    }
    return [];
  }

  private isBrowserUnavailableError(error: unknown): boolean {
    const text = String(error ?? "").toLowerCase();
    return text.includes("can't reach the openclaw browser control service");
  }

  private async executeToolWithRecovery(params: {
    tool: AnyAgentTool;
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) {
    try {
      return await params.tool.execute(params.callId, params.args);
    } catch (error) {
      if (params.toolName !== "browser" || !this.isBrowserUnavailableError(error)) {
        throw error;
      }

      this.options.onProgress?.("browser unavailable, attempting one recovery start...");
      const target =
        typeof params.args.target === "string" && params.args.target.trim()
          ? params.args.target.trim()
          : undefined;
      const profile =
        typeof params.args.profile === "string" && params.args.profile.trim()
          ? params.args.profile.trim()
          : undefined;

      await params.tool.execute(`${params.callId}-recovery-start`, {
        action: "start",
        ...(target ? { target } : {}),
        ...(profile ? { profile } : {}),
      });
      this.options.onProgress?.("browser recovery start complete, retrying action once...");
      return await params.tool.execute(`${params.callId}-retry`, params.args);
    }
  }

  private formatFinalAnswer(params: {
    finalAnswer: string;
    visitedUrls: Set<string>;
    stepsUsed: number;
    maxSteps: number;
  }): string {
    const evidence = Array.from(params.visitedUrls).slice(0, 8);
    const evidenceText = evidence.length > 0 ? `\n\nEvidence URLs:\n- ${evidence.join("\n- ")}` : "";
    return [
      params.finalAnswer,
      `\n\nRun stats: ${params.stepsUsed}/${params.maxSteps} steps used.`,
      evidenceText,
    ].join("");
  }

  async browse(task: AutonomousBrowserTask): Promise<string> {
    if (task.targetUrl) {
      const memory = await this.checkMemory(task.targetUrl);
      if (memory) {
        this.options.onProgress?.(`Found memory for ${task.targetUrl}`);
        return `Memory retrieved for ${task.targetUrl}:\n\nSummary:\n${memory.summary}\n\nData:\n${JSON.stringify(memory.data, null, 2)}`;
      }
    }

    const defModel = resolveDefaultModelForAgent({ cfg: this.config, agentId: "browser-agent" });
    const model = getModel(defModel.provider as any, defModel.model);
    const apiKey = getEnvApiKey(defModel.provider as any);
    const maxSteps = this.normalizeBoundedInteger(task.maxSteps, DEFAULT_MAX_STEPS, 1, MAX_STEPS_HARD_LIMIT);
    const timeoutMs = this.normalizeBoundedInteger(task.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 15 * 60_000);
    const deadline = Date.now() + timeoutMs;

    const tools: AnyAgentTool[] = [
      createBrowserTool({ allowHostControl: false }),
      createWebSearchTool({ sandboxed: true }),
      createWebFetchTool({ sandboxed: true }),
    ];

    const taskSummary = task.targetUrl ? `${task.query} (${task.targetUrl})` : task.query;
    const planTasks = this.createPlanTasks();
    await this.writePlan(`Autonomous browser: ${taskSummary}`, planTasks);

    const context: Context = {
      messages: [
        {
          role: "system" as const,
          timestamp: Date.now(),
          content: [
            {
              type: "text",
              text: [
                BROWSER_AGENT_HINT,
                "",
                "Execution rules:",
                "- Use an Operator-style loop: plan -> act -> observe.",
                "- Prefer browser snapshot + browser act for page interaction.",
                "- Use web_search for discovery and web_fetch for extraction.",
                "- Keep progress concise in short text updates.",
                "- Finish with one line starting with FINAL: followed by the answer.",
              ].join("\n"),
            },
          ],
        },
        {
          role: "user",
          timestamp: Date.now(),
          content: [
            {
              type: "text",
              text: [
                `Task: ${task.query}`,
                task.targetUrl ? `Target URL: ${task.targetUrl}` : "",
                task.allowedDomains?.length ? `Allowed domains: ${task.allowedDomains.join(", ")}` : "",
                `Step budget: ${maxSteps}`,
                "Start now.",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        },
      ],
    };

    const visitedUrls = new Set<string>();
    let iterations = 0;
    let lastUrl = task.targetUrl || "";

    while (iterations < maxSteps) {
      if (Date.now() > deadline) {
        break;
      }
      iterations++;

      const response = await complete(model as Model<any>, context, {
        apiKey,
        tools: tools as any,
      });

      context.messages.push(response);

      let textOutput = "";
      const toolCallsToRun: Array<{ id: string; name: string; arguments: unknown }> = [];

      if (Array.isArray(response.content)) {
        for (const block of response.content) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            textOutput += `${block.text.trim()}\n`;
            continue;
          }
          if (block.type === "toolCall") {
            const callId = typeof block.id === "string" ? block.id : `browser-call-${iterations}`;
            const callName = typeof block.name === "string" ? block.name : "";
            toolCallsToRun.push({ id: callId, name: callName, arguments: block.arguments });
          }
        }
      }

      if (textOutput.trim()) {
        this.options.onProgress?.(textOutput.trim());
      }

      if (toolCallsToRun.length === 0) {
        planTasks[1].status = "done";
        planTasks[2].status = "done";
        planTasks[3].status = "done";
        await this.writePlan(`Autonomous browser: ${taskSummary}`, planTasks);
        const finalAnswer = extractFinalAnswerText(textOutput);
        if (lastUrl) {
          await this.storeMemory(lastUrl, finalAnswer, {
            query: task.query,
            visitedUrls: Array.from(visitedUrls),
          });
        }
        return this.formatFinalAnswer({
          finalAnswer: finalAnswer || "Completed browsing task.",
          visitedUrls,
          stepsUsed: iterations,
          maxSteps,
        });
      }

      const boundedToolCalls = toolCallsToRun.slice(0, TOOL_CALLS_PER_TURN_LIMIT);
      const toolResults: ToolResultMessage = {
        role: "toolResult",
        toolCallId: "",
        toolName: "",
        timestamp: Date.now(),
        content: [],
      } as any;

      for (const call of boundedToolCalls) {
        const tool = tools.find((entry) => entry.name === call.name);
        if (!tool) {
          toolResults.content.push({
            type: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            isError: true,
            content: [{ type: "text", text: "Tool not found" }],
          } as any);
          continue;
        }

        try {
          const urlCandidates = this.readToolUrlCandidates(call.name, call.arguments);
          for (const candidate of urlCandidates) {
            if (!isSafeBrowserUrl(candidate)) {
              throw new Error(`Blocked unsafe URL: ${candidate}`);
            }
            if (!isDomainAllowed(candidate, task.allowedDomains)) {
              throw new Error(`Blocked by allowedDomains policy: ${candidate}`);
            }
            visitedUrls.add(candidate);
            lastUrl = candidate;
          }

          this.options.onProgress?.(this.readActionProgress(call.name, call.arguments));
          const rawResult = await this.executeToolWithRecovery({
            tool,
            callId: call.id,
            toolName: call.name,
            args: (call.arguments as Record<string, unknown>) ?? {},
          });
          const resultText =
            typeof rawResult === "object" ? JSON.stringify(rawResult, null, 2) : String(rawResult);
          toolResults.content.push({
            type: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            content: [{ type: "text", text: resultText }],
          } as any);
        } catch (e) {
          toolResults.content.push({
            type: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            isError: true,
            content: [{ type: "text", text: String(e) }],
          } as any);
        }
      }

      context.messages.push(toolResults);
    }

    planTasks[1].status = "done";
    planTasks[2].status = "done";
    planTasks[3].status = "done";
    await this.writePlan(`Autonomous browser: ${taskSummary}`, planTasks);

    const timeoutReason = Date.now() > deadline ? "Timeout reached" : "Step budget reached";
    const fallback = `${timeoutReason}. Partial browsing completed.`;
    if (lastUrl) {
      await this.storeMemory(lastUrl, fallback, {
        query: task.query,
        visitedUrls: Array.from(visitedUrls),
      });
    }
    return this.formatFinalAnswer({
      finalAnswer: fallback,
      visitedUrls,
      stepsUsed: iterations,
      maxSteps,
    });
  }
}
