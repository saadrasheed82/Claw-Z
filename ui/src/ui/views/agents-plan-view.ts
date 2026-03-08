import { html, nothing } from "lit";
import { icons } from "../icons.ts";
import type { AgentsPlan, AgentsPlanTask } from "../types.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type { AgentContext } from "./agents-utils.ts";

export function renderAgentPlan(params: {
  context: AgentContext;
  plan: AgentsPlan | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const { plan, loading, error, onRefresh, context } = params;

  return html`
    <section class="grid grid-cols-2">
      <section class="card">
        <div class="card-title">Agent Context</div>
        <div class="card-sub">Workspace and model configuration.</div>
        <div class="agents-overview-grid" style="margin-top: 16px;">
          <div class="agent-kv">
            <div class="label">Workspace</div>
            <div class="mono">${context.workspace}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Primary Model</div>
            <div class="mono">${context.model}</div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Planning Status</div>
            <div class="card-sub">Current active plan and task breakdown.</div>
          </div>
          <button class="btn btn--sm" ?disabled=${loading} @click=${onRefresh}>
            ${loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        ${error ? html`<div class="callout danger" style="margin-top: 12px;">${error}</div>` : nothing}
        ${!plan && !loading ? html`<div class="callout info" style="margin-top: 12px;">No active plan found for this agent.</div>` : nothing}
        ${plan ? html`
          <div class="stat-grid" style="margin-top: 16px;">
            <div class="stat">
              <div class="stat-label">Tasks</div>
              <div class="stat-value">${plan.tasks.length}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Done</div>
              <div class="stat-value">${plan.tasks.filter(t => t.status === 'done').length}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Last Updated</div>
              <div class="stat-value">${formatRelativeTimestamp(new Date(plan.updatedAt).getTime())}</div>
            </div>
          </div>
        ` : nothing}
      </section>
    </section>

    ${plan ? html`
      <section class="card plan-container">
        <div class="plan-header">
          <div class="card-title">Current Plan</div>
          <div class="plan-summary">${plan.summary}</div>
        </div>

        <div class="task-list">
          ${plan.tasks.map(task => renderTaskRow(task))}
        </div>
      </section>
    ` : nothing}

    <style>
      .plan-container {
        margin-top: 20px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .plan-header {
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 16px;
      }
      .plan-summary {
        margin-top: 8px;
        font-size: 1.1em;
        line-height: 1.5;
        color: var(--text-color);
      }
      .task-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .task-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: var(--bg-card-alt);
        border-radius: 8px;
        border: 1px solid var(--border-color);
        transition: transform 0.2s, background 0.2s;
      }
      .task-row:hover {
        background: var(--bg-card-hover);
        transform: translateX(4px);
      }
      .task-status-icon {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .task-status-icon svg {
        width: 100%;
        height: 100%;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
      }
      .task-status--todo { color: var(--text-muted); }
      .task-status--in_progress { color: var(--primary-color); }
      .task-status--done { color: var(--success-color); }
      
      .task-title {
        flex: 1;
        font-weight: 500;
      }
      .task-status-label {
        font-size: 0.8em;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 600;
        opacity: 0.7;
      }
    </style>
  `;
}

function renderTaskRow(task: AgentsPlanTask) {
  let icon = icons.circle;
  let statusClass = "task-status--todo";
  if (task.status === "done") {
    icon = icons.check;
    statusClass = "task-status--done";
  } else if (task.status === "in_progress") {
    icon = icons.loader;
    statusClass = "task-status--in_progress";
  }

  return html`
    <div class="task-row">
      <div class="task-status-icon ${statusClass}">
        ${icon}
      </div>
      <div class="task-title">${task.title}</div>
      <div class="task-status-label ${statusClass}">${task.status.replace('_', ' ')}</div>
    </div>
  `;
}
