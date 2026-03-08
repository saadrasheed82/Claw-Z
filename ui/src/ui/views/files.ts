import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import { icons } from "../icons.ts";

interface WorkspaceFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAtMs?: number;
}

export interface FilesProps {
  files: WorkspaceFile[];
  loading: boolean;
  error?: string;
  currentPath: string;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  onNavigateUp: () => void;
  onCreateFile: (name: string, isDirectory: boolean) => void;
  onDeleteFile: (path: string) => void;
}

export function renderFiles(props: FilesProps) {
  const { files, loading, error, currentPath, onRefresh, onNavigate, onNavigateUp, onCreateFile, onDeleteFile } = props;

  return html`
    <div class="files-view">
      <div class="files-toolbar">
        <button class="btn btn--sm" @click=${onRefresh} ?disabled=${loading}>
          ${icons.refresh}
          <span>${t("actions.refresh")}</span>
        </button>
        <button class="btn btn--sm" @click=${onNavigateUp} ?disabled=${!currentPath}>
          ${icons.arrowUp}
          <span>${t("files.goUp")}</span>
        </button>
        <div class="dropdown">
          <button class="btn btn--sm dropdown__toggle">
            ${icons.plus}
            <span>${t("files.create")}</span>
          </button>
          <div class="dropdown__menu">
            <button class="dropdown__item" @click=${() => onCreateFile("", false)}>
              ${icons.file}
              <span>${t("files.newFile")}</span>
            </button>
            <button class="dropdown__item" @click=${() => onCreateFile("", true)}>
              ${icons.folder}
              <span>${t("files.newFolder")}</span>
            </button>
          </div>
        </div>
      </div>

      ${loading
        ? html`<div class="files-loading">${t("status.loading")}</div>`
        : error
          ? html`<div class="files-error">${error}</div>`
          : html`
              <div class="files-breadcrumb">
                <span class="files-path">${currentPath || "/"}</span>
              </div>
              <div class="files-list">
                ${files.length === 0
                  ? html`<div class="files-empty">${t("files.empty")}</div>`
                  : files.map(
                      (file) => html`
                        <div class="file-item" @click=${() => file.isDirectory && onNavigate(file.path)}>
                          <span class="file-icon">
                            ${file.isDirectory ? icons.folder : icons.file}
                          </span>
                          <span class="file-name">${file.name}</span>
                          ${file.size !== undefined
                            ? html`<span class="file-size">${formatFileSize(file.size)}</span>`
                            : nothing}
                          <button
                            class="file-delete"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              onDeleteFile(file.path);
                            }}
                          >
                            ${icons.trash}
                          </button>
                        </div>
                      `
                    )}
              </div>
            `}
    </div>
  `;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const nothing = false ? true : false;
