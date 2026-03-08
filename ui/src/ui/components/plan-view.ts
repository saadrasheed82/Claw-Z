import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { icons } from "../icons.ts";

export type PlanTask = {
  id: string;
  title: string;
  status: "Pending" | "In Progress" | "Done";
};

@customElement("plan-view")
export class PlanView extends LitElement {
  @property({ type: String }) rawPlan = "[]";
  @property({ type: Boolean }) isProceeding = false;

  @state() private tasks: PlanTask[] = [];
  @state() private parseError = false;

  static styles = css`
    .plan-container {
      background: var(--bg-card, #202020);
      border: 1px solid var(--border-color, #444);
      border-radius: 8px;
      padding: 16px;
      margin: 12px 0;
      font-family: var(--font-base, system-ui, sans-serif);
      color: var(--text-base, #e0e0e0);
    }
    .plan-header {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .plan-task {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 8px;
      border-radius: 6px;
      transition: background 0.2s;
    }
    .plan-task:hover {
      background: var(--bg-hover, rgba(255,255,255,0.05));
    }
    .plan-task input[type="checkbox"] {
      margin-top: 4px;
      cursor: pointer;
    }
    .task-title {
      flex: 1;
      line-height: 1.4;
    }
    .task-status {
      font-size: 0.75rem;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-secondary, #333);
      white-space: nowrap;
    }
    .task-status.pending { color: #888; }
    .task-status.inprogress { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
    .task-status.done { color: #10b981; background: rgba(16, 185, 129, 0.1); text-decoration: line-through; }
    
    .plan-actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--border-color, #444);
    }
    .btn {
      padding: 6px 12px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.85rem;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn.primary { background: var(--color-primary, #3b82f6); color: white; }
    .btn.secondary { background: var(--bg-secondary, #444); color: white; }
    .btn.danger { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `;

  willUpdate(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has("rawPlan")) {
      try {
        const parsed = JSON.parse(this.rawPlan);
        if (Array.isArray(parsed)) {
          this.tasks = parsed.map(t => ({
            id: t.id || Math.random().toString(36).substring(7),
            title: t.title || "Unnamed Task",
            status: t.status || "Pending"
          }));
          this.parseError = false;
        } else {
          this.parseError = true;
        }
      } catch (e) {
        this.parseError = true;
      }
    }
  }

  private toggleTaskStatus(index: number) {
    if (!this.isProceeding) return; // Only allow interactive toggling if proceeded
    const newTasks = [...this.tasks];
    const current = newTasks[index].status;
    if (current === "Pending") newTasks[index].status = "In Progress";
    else if (current === "In Progress") newTasks[index].status = "Done";
    else newTasks[index].status = "Pending";
    this.tasks = newTasks;
    this.dispatchEvent(new CustomEvent('plan-updated', { detail: { tasks: this.tasks } }));
  }

  render() {
    if (this.parseError) {
      return html`<div class="callout danger">Could not parse execution plan. Expected a JSON array of tasks.</div>`;
    }

    return html`
      <div class="plan-container">
        <div class="plan-header">
          ${icons.clipboard || ''} Execution Plan
        </div>
        <div class="plan-list">
          ${this.tasks.map((task, i) => html`
            <div class="plan-task">
              <input 
                type="checkbox" 
                .checked=${task.status === "Done"}
                ?disabled=${!this.isProceeding}
                @change=${() => this.toggleTaskStatus(i)}
              />
              <span class="task-title ${task.status === "Done" ? "muted" : ""}" style="${task.status === "Done" ? 'text-decoration: line-through;' : ''}">
                ${task.title}
              </span>
              <span class="task-status ${task.status.replace(' ', '').toLowerCase()}">${task.status}</span>
            </div>
          `)}
        </div>
        
        ${!this.isProceeding ? html`
          <div class="plan-actions">
            <button class="btn primary" @click=${() => { this.isProceeding = true; this.dispatchEvent(new CustomEvent('plan-proceed')); }}>Proceed</button>
            <button class="btn secondary" @click=${() => this.dispatchEvent(new CustomEvent('plan-modify'))}>Modify Plan</button>
            <button class="btn danger" @click=${() => this.dispatchEvent(new CustomEvent('plan-cancel'))}>Cancel</button>
          </div>
        ` : html`
          <div class="plan-actions" style="justify-content: space-between; align-items: center;">
            <span class="muted" style="font-size: 0.8rem;">Plan in progress. Check items off as they complete.</span>
            <button class="btn secondary" @click=${() => { this.isProceeding = false; }}>Pause Execution</button>
          </div>
        `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "plan-view": PlanView;
  }
}
