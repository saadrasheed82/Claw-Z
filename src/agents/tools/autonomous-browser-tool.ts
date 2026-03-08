import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";
import { AutonomousBrowser } from "../autonomous-browser.js";

const AutonomousBrowserSchema = Type.Object({
  query: Type.String({ description: "What to search for or research" }),
  targetUrl: Type.Optional(Type.String({ description: "Specific URL to start from" })),
  allowedDomains: Type.Optional(
    Type.Array(
      Type.String({ description: "Allowed domain (example.com); subdomains are allowed." }),
    ),
  ),
  maxSteps: Type.Optional(Type.Number({ description: "Maximum plan/act/observe steps (1-40)." })),
  timeoutMs: Type.Optional(Type.Number({ description: "Overall timeout in milliseconds." })),
});

export function createAutonomousBrowserTool(options: {
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    name: "autonomous_browser",
    label: "Autonomous Browser",
    description: "Launch an autonomous browser to search the web, read pages, and extract information. Hides internal browser tool calls from the main chat. Use this whenever the user asks you to search the web, visit a URL, or research online.",
    parameters: AutonomousBrowserSchema,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { allowEmpty: true }) || "";
      const targetUrl = readStringParam(params, "targetUrl", { allowEmpty: true });
      const allowedDomains = Array.isArray(params.allowedDomains)
        ? params.allowedDomains
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : undefined;
      const maxSteps =
        typeof params.maxSteps === "number" && Number.isFinite(params.maxSteps)
          ? params.maxSteps
          : undefined;
      const timeoutMs =
        typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
          ? params.timeoutMs
          : undefined;

      const browser = new AutonomousBrowser({
        sessionKey: options.agentSessionKey || "",
        onProgress: (msg) => {
           if (onUpdate) {
             onUpdate({
               content: [{ type: "text", text: msg }],
               details: { msg }
             });
           }
        }
      });

      const result = await browser.browse({ query, targetUrl, allowedDomains, maxSteps, timeoutMs });
      return {
        content: [{ type: "text", text: result }],
        details: { result }
      };
    }
  };
}
