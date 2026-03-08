import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAtMs?: number;
}

async function listWorkspaceFilesRecursive(
  workspaceDir: string,
  relativePath: string = "",
): Promise<WorkspaceFileEntry[]> {
  const entries: WorkspaceFileEntry[] = [];
  const fullPath = path.join(workspaceDir, relativePath);

  try {
    const items = await fs.readdir(fullPath, { withFileTypes: true });

    for (const item of items) {
      const itemPath = path.join(relativePath, item.name);
      const fullItemPath = path.join(fullPath, item.name);

      try {
        const stat = await fs.stat(fullItemPath);
        entries.push({
          name: item.name,
          path: itemPath,
          isDirectory: item.isDirectory(),
          size: item.isDirectory() ? undefined : stat.size,
          updatedAtMs: Math.floor(stat.mtimeMs),
        });
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function resolveAgentWorkspaceFilePathOrRespondError(
  params: Record<string, unknown>,
  respond: RespondFn,
): { workspaceDir: string; filePath: string; relativePath: string } | null {
  const cfg = loadConfig();
  const rawAgentId = params.agentId;
  const agentId =
    typeof rawAgentId === "string" || typeof rawAgentId === "number" ? String(rawAgentId) : "main";
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  const rawPath = params.path;
  const relativePath =
    typeof rawPath === "string" || typeof rawPath === "number" ? String(rawPath) : "";

  const normalizedPath = path.normalize(relativePath).replace(/^(\.\.(\/|\\))+/, "");
  const fullPath = path.join(workspaceDir, normalizedPath);

  if (!fullPath.startsWith(workspaceDir)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path escape not allowed"));
    return null;
  }

  return { workspaceDir, filePath: fullPath, relativePath: normalizedPath };
}

export const workspaceFilesHandlers: GatewayRequestHandlers = {
  "workspace-files.list": async ({ params, respond }) => {
    const agentId =
      typeof params.agentId === "string" || typeof params.agentId === "number"
        ? String(params.agentId)
        : "main";
    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

    const files = await listWorkspaceFilesRecursive(workspaceDir);

    respond(true, { agentId, workspace: workspaceDir, files }, undefined);
  },

  "workspace-files.create": async ({ params, respond }) => {
    const resolved = resolveAgentWorkspaceFilePathOrRespondError(params, respond);
    if (!resolved) {
      return;
    }

    const { workspaceDir, filePath, relativePath } = resolved;
    const isDirectory = typeof params.isDirectory === "boolean" ? params.isDirectory : false;

    try {
      if (isDirectory) {
        await fs.mkdir(filePath, { recursive: true });
      } else {
        const content = typeof params.content === "string" ? params.content : "";
        await fs.writeFile(filePath, content, "utf-8");
      }

      const stat = await fs.stat(filePath);
      respond(
        true,
        {
          ok: true,
          entry: {
            name: path.basename(relativePath),
            path: relativePath,
            isDirectory,
            size: isDirectory ? undefined : stat.size,
            updatedAtMs: Math.floor(stat.mtimeMs),
          },
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `failed to create: ${err}`),
      );
    }
  },

  "workspace-files.delete": async ({ params, respond }) => {
    const resolved = resolveAgentWorkspaceFilePathOrRespondError(params, respond);
    if (!resolved) {
      return;
    }

    const { workspaceDir, filePath, relativePath } = resolved;

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true });
      } else {
        await fs.unlink(filePath);
      }
      respond(true, { ok: true, path: relativePath }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `failed to delete: ${err}`),
      );
    }
  },

  "workspace-files.read": async ({ params, respond }) => {
    const resolved = resolveAgentWorkspaceFilePathOrRespondError(params, respond);
    if (!resolved) {
      return;
    }

    const { filePath, relativePath } = resolved;

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cannot read directory"));
        return;
      }

      const content = await fs.readFile(filePath, "utf-8");
      respond(
        true,
        {
          path: relativePath,
          content,
          size: stat.size,
          updatedAtMs: Math.floor(stat.mtimeMs),
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `failed to read: ${err}`),
      );
    }
  },
};
