import {
  Task,
  Member,
  Title,
  Deliverable,
  contractVersion,
} from "@research-agent-platform/contracts";
import type { TaskModel } from "@research-agent-platform/contracts";
import {
  fixtures as sharedFixtures,
  unknownSchedule,
} from "@research-agent-platform/contracts/fixtures";
import { projectTask } from "./contract-projection";
import type { TaskCardView, PreviewView, ReadAdapter } from "./view-model";
// Synthetic presentation content validated by the frozen B0 0.1.0 schemas.
// Never imported by production; this adapter performs no service commands.
const content: Omit<PreviewView, "tasks"> & {
  tasks: Omit<TaskCardView, "column" | "state">[];
} = {
  dateLabel: "9月21日 周一 · 示例时点",
  availabilityCaption:
    "成员自报 · 适用 2026年9月21日–27日 · 更新于 9月21日（合成示例）",
  tasks: [
    {
      id: "patent",
      title: "专利技术交底",
      category: "知识产权",
      people: "待认领",
      date: "时间待确认",
      mine: false,
    },
    {
      id: "intern",
      title: "实习生入组安排",
      category: "学生培养",
      people: "负责人待定",
      date: "时间待定",
      mine: false,
    },
    {
      id: "proposal",
      title: "项目申请书",
      category: "科研项目",
      people: "洛、林",
      date: "9月25日交初稿",
      accepted: 1,
      total: 5,
      note: "等待洛确认研究主线。",
      mine: true,
      detail: {
        people: "负责人 洛 · 参与 林同学 · 9月25日交付内部初稿（已确认）",
        summary: "已验收 1 / 5 项；前期成果整理可继续，初稿整合等待方向确认。",
        blocker: "研究主线尚未确认。",
        next: "需要洛确认后，写作助手才能开始整合。",
        dependency:
          "初稿整合依赖：研究主线确认、前期成果交付。已验收项数不代表工时完成比例。",
        deliverable: "文献依据清单.md",
        review: "已验收 · 9月20日 · 合成示例",
        update: "林同学已接受前期成果整理",
        updatedAt: "9月21日 10:20 · 合成示例",
      },
    },
    {
      id: "paper",
      title: "论文返修",
      category: "科研论文",
      people: "陈",
      date: "9月25日",
      accepted: 2,
      total: 4,
      mine: false,
    },
    {
      id: "data",
      title: "实验数据整理",
      category: "实验与数据",
      people: "王",
      date: "9月21日",
      note: "数据包已交付，等待验收",
      mine: true,
    },
    {
      id: "meeting",
      title: "组会汇报材料",
      category: "汇报事务",
      people: "林",
      date: "9月18日",
      note: "已验收",
      mine: true,
    },
  ],
  members: [
    {
      name: "洛",
      commitment: "申请书 · 方向确认",
      next: "今天",
      availability: "本周较满",
    },
    {
      name: "林",
      commitment: "申请书 · 前期成果",
      next: "9月23日",
      availability: "还可接半天",
    },
    {
      name: "陈",
      commitment: "论文返修 · 补充分析",
      next: "9月24日",
      availability: "本周已满",
    },
    {
      name: "王",
      commitment: "实验数据整理",
      next: "已交付",
      availability: "未知 · 尚未填写",
    },
  ],
  steps: [
    {
      title: "梳理文献依据",
      output: "证据清单与来源",
      actor: "公共文献助手（示例）",
      date: "9月20日",
      state: "已完成 · 已验收",
      tone: "green",
    },
    {
      title: "明确研究主线",
      output: "研究目标与创新点",
      actor: "洛",
      date: "今天",
      state: "待开始 · 需确认",
      tone: "amber",
    },
    {
      title: "补齐前期成果",
      state: "进行中",
      output: "成果与附件清单",
      actor: "林同学",
      date: "9月23日",
      tone: "green",
    },
    {
      title: "整合申请书初稿",
      output: "申请书草稿",
      actor: "公共写作助手（示例）",
      date: "9月24日 · 建议",
      state: "受阻 · 等待前置完成",
      tone: "muted",
    },
    {
      title: "核对申报格式",
      state: "待安排",
      output: "格式与必填项清单",
      actor: "待补充能力",
      date: "9月25日 · 待确认",
      tone: "muted",
    },
  ],
};

export const fixtureContractVersion = contractVersion;
const statuses: TaskModel["status"][] = [
  "unassigned",
  "unassigned",
  "blocked",
  "in_progress",
  "in_review",
  "completed",
];
const kinds: TaskModel["taskType"][] = [
  "ip",
  "training",
  "grant",
  "paper",
  "experiment",
  "report",
];
const base = sharedFixtures.blockedTask.schema.parse(
  sharedFixtures.blockedTask.value,
).data;
export const contractTasks = content.tasks.map((view, index) =>
  Task.parse({
    ...base,
    id: view.id,
    title: view.title,
    taskType: kinds[index],
    status: statuses[index],
    leadId: [null, null, "member_A", "member_C", "member_D", "member_B"][index],
    participantIds: index === 2 ? ["member_B"] : [],
    blocker:
      statuses[index] === "blocked"
        ? {
            reason: view.note!,
            requestedMemberId: "member_A",
            requestedAction: "确认研究主线",
            resumeStatus: "in_progress",
          }
        : null,
    schedule:
      index < 2
        ? unknownSchedule
        : {
            ...unknownSchedule,
            committed: {
              value: {
                kind: "date",
                date: `2026-09-${index === 4 ? "21" : index === 5 ? "18" : "25"}`,
                timezone: "Asia/Shanghai",
              },
              source: "member",
              confirmed: true,
            },
          },
    allowedActions: [],
  }),
);
// Validate members with the same B0 schema. Presentation contains only public synthetic labels.
export const contractMembers = content.members.map((view, index) =>
  Member.parse({
    id: ["member_A", "member_B", "member_C", "member_D"][index],
    labId: "lab_synthetic",
    displayName: view.name,
    publicExpertise: [],
    availability:
      index === 3
        ? null
        : {
            from: "2026-09-21",
            to: "2026-09-27",
            timezone: "Asia/Shanghai",
            level: index === 2 ? "unavailable" : "limited",
            hours: index === 1 ? 4 : null,
            updatedAt: "2026-09-21T08:00:00+08:00",
          },
    visibleCommitments: [
      {
        taskId: ["proposal", "proposal", "paper", "data"][index],
        scope: view.commitment,
        schedule: unknownSchedule,
      },
    ],
    version: 1,
  }),
);
const childStatuses: TaskModel["status"][] = [
  "completed",
  "ready",
  "in_progress",
  "blocked",
  "unassigned",
];
export const contractSteps = content.steps.map((step, index) =>
  Task.parse({
    ...base,
    id: `proposal_step_${index}`,
    parentTaskId: "proposal",
    title: step.title,
    goal: step.output,
    status: childStatuses[index],
    leadId: index === 4 ? null : index === 2 ? "member_B" : "member_A",
    blocker:
      index === 3
        ? {
            reason: "等待研究主线确认及前期成果交付",
            requestedMemberId: "member_A",
            requestedAction: "完成前置交付",
            resumeStatus: "ready",
          }
        : null,
    dependencies:
      index === 3
        ? [
            {
              taskId: "proposal_step_1",
              kind: "confirmed_decision",
              requiredRevision: null,
            },
            {
              taskId: "proposal_step_2",
              kind: "accepted_deliverable",
              requiredRevision: null,
            },
          ]
        : [],
    schedule: unknownSchedule,
    allowedActions: [],
  }),
);
export const contractDelivery = Deliverable.parse({
  ...sharedFixtures.pendingReview.value.data,
  taskId: "proposal_step_0",
  summary: "合成文献依据清单，未实际检索",
  review: {
    decision: "accepted",
    reviewerId: "member_A",
    revision: 1,
    comment: "合成验收记录",
    at: "2026-09-20T08:00:00+08:00",
  },
});
export const fixture: PreviewView = {
  ...content,
  tasks: contractTasks
    .map((task, index) => projectTask(task, content.tasks[index]!)!)
    .filter(Boolean),
};
export function createFixtureAdapter(scenario: string): ReadAdapter {
  return {
    async read(signal) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          resolve,
          scenario === "loading" ? 60_000 : 180,
        );
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
      if (scenario === "error")
        throw new Error("演示请求失败。此状态没有返回任务数据。");
      if (scenario === "empty") return { tasks: [], members: [], steps: [] };
      const data = structuredClone(fixture);
      if (scenario === "long")
        data.tasks[2]!.title = Title.parse(
          "跨学科科研项目申请书：面向复杂环境的多模态研究方法、实验验证与开放协作成果整理（第二轮修改）",
        );
      return data;
    },
  };
}
