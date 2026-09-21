import { taskColumns } from "@research-agent-platform/contracts";
import type { TaskModel } from "@research-agent-platform/contracts";
import type { TaskCardView } from "./view-model";

// Translations only. Legal transitions and aggregation semantics belong to B0.
const labels: Record<TaskModel["status"], string> = {
  unassigned: "待安排",
  awaiting_acceptance: "待承接",
  ready: "待开始",
  in_progress: "进行中",
  blocked: "受阻",
  in_review: "待验收",
  changes_requested: "需修改",
  completed: "已完成",
  cancelled: "已取消",
};
const columns = ["unassigned", "active", "review", "completed"] as const;
export function projectTask(
  task: TaskModel,
  presentation: Omit<TaskCardView, "id" | "title" | "column" | "state">,
): TaskCardView | null {
  const column = taskColumns[task.status];
  if (column === null) return null; // Cancelled is not completed and is excluded from these four columns.
  return {
    ...presentation,
    id: task.id,
    title: task.title,
    state: labels[task.status],
    column: columns.indexOf(column),
  };
}
