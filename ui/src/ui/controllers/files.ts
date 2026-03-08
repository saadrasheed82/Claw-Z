import type { AppViewState } from "../app-view-state.ts";

interface WorkspaceFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAtMs?: number;
}

interface ListResponse {
  files: WorkspaceFileEntry[];
  workspace: string;
}

export async function loadFiles(state: AppViewState): Promise<void> {
  state.filesLoading = true;
  state.filesError = null;

  try {
    const client = state.client;
    if (!client) {
      state.filesError = "Not connected";
      return;
    }

    const result = await client.request("workspace-files.list", { agentId: "main" }) as ListResponse;

    state.filesList = result.files;
  } catch (err) {
    state.filesError = err instanceof Error ? err.message : "Unknown error";
  }

  state.filesLoading = false;
}

export async function navigateFiles(state: AppViewState, path: string): Promise<void> {
  state.filesCurrentPath = path;
  await loadFiles(state);
}

export async function navigateFilesUp(state: AppViewState): Promise<void> {
  const parts = state.filesCurrentPath.split("/").filter(Boolean);
  parts.pop();
  state.filesCurrentPath = parts.join("/");
  await loadFiles(state);
}

export async function createWorkspaceFile(
  state: AppViewState,
  name: string,
  isDirectory: boolean,
): Promise<void> {
  const fullPath = state.filesCurrentPath
    ? `${state.filesCurrentPath}/${name}`
    : name;

  try {
    const client = state.client;
    if (!client) {
      state.filesError = "Not connected";
      return;
    }

    await client.request("workspace-files.create", {
      agentId: "main",
      path: fullPath,
      isDirectory,
      content: "",
    });

    await loadFiles(state);
  } catch (err) {
    state.filesError = err instanceof Error ? err.message : "Unknown error";
  }
}

export async function deleteWorkspaceFile(state: AppViewState, path: string): Promise<void> {
  try {
    const client = state.client;
    if (!client) {
      state.filesError = "Not connected";
      return;
    }

    await client.request("workspace-files.delete", {
      agentId: "main",
      path,
    });

    await loadFiles(state);
  } catch (err) {
    state.filesError = err instanceof Error ? err.message : "Unknown error";
  }
}
