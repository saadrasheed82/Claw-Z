import type { AppViewState } from "../app-view-state.ts";

export async function loadAgentPlan(state: AppViewState, agentId: string) {
  if (!state.client) {
    return;
  }

  state.agentPlanLoading = true;
  state.agentPlanError = null;

  try {
    const result = await state.client.request({
      method: "agents.plan.get",
      params: { agentId },
    });

    if (result.kind === "ok") {
      state.agentPlan = {
        ...state.agentPlan,
        [agentId]: result.plan,
      };
    } else {
      state.agentPlanError = result.reason || "Failed to load agent plan";
    }
  } catch (err) {
    console.error("Failed to load agent plan:", err);
    state.agentPlanError = String(err);
  } finally {
    state.agentPlanLoading = false;
  }
}
