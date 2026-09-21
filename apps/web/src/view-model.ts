/** F0 display-only projections, NOT API DTOs. Replace at the B0 adapter boundary.
 * No commands, status transitions, authentication, or persistence are defined here. */
export interface TaskCardView {
  id: string;
  title: string;
  category: string;
  column: number;
  state: string;
  people: string;
  date: string;
  note?: string;
  accepted?: number;
  total?: number;
  scopeMemberIds: string[];
  detail?: {
    people: string;
    summary: string;
    blocker: string;
    next: string;
    dependency: string;
    deliverable: string;
    review: string;
    update: string;
    updatedAt: string;
  };
}
export interface StepView {
  title: string;
  output: string;
  actor: string;
  date: string;
  state: string;
  tone: "green" | "amber" | "muted";
}
export interface MemberView {
  name: string;
  commitment: string;
  next: string;
  availability: string;
}
export interface PreviewView {
  currentMemberId?: string;
  tasks: TaskCardView[];
  members: MemberView[];
  steps: StepView[];
  dateLabel?: string;
  availabilityCaption?: string;
}
// Presentation filtering for already-visible demo data, not authorization.
// F1 must consume the server-authorized scope=mine response.
export function tasksInScope(view: PreviewView, scope: string): TaskCardView[] {
  if (scope === 'lab') return view.tasks;
  if (!view.currentMemberId) return [];
  return view.tasks.filter(task => task.scopeMemberIds.includes(view.currentMemberId!));
}
export interface ReadAdapter {
  read(signal: AbortSignal): Promise<PreviewView>;
}
export class ViewUnavailable extends Error {}
export const unavailableAdapter: ReadAdapter = {
  async read() {
    throw new ViewUnavailable(
      "任务服务尚未接通。请稍后重试，或联系维护者确认服务接入。",
    );
  },
};
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
