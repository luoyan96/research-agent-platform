import "@phosphor-icons/web/regular";
import "./style.css";
import { escapeHtml as e, unavailableAdapter, tasksInScope } from "./view-model";
import type { PreviewView, TaskCardView } from "./view-model";

const app = document.querySelector<HTMLDivElement>("#app")!;
const demo = __DEMO__;
let data: PreviewView | undefined;
let pending: AbortController | undefined;
let scope = "lab";
let draft = "";
let activeRoute = "";
const icon = (name: string) =>
  `<i class="ph ph-${name}" aria-hidden="true"></i>`;
const route = () => location.hash.slice(1) || "/";
const link = (url: string, label: string, cls = "") =>
  `<a class="${cls}" href="#${url}">${label}</a>`;
const noticeButton = (
  label: string,
  cls = "",
  message = "此功能将在后续阶段接通；本轮只提供界面预览，不会创建或修改任务。",
) => `<button class="${cls}" data-notice="${e(message)}">${label}</button>`;

function shell() {
  app.innerHTML = `<button class="skip" type="button" data-skip>跳到主要内容</button><header>
    ${link("/", '<img src="/brand.png" alt="" width="38" height="38"><span>Research Agent Platform</span>', "brand")}
    <nav aria-label="主导航">${link(route() === "/" ? "/lab" : "/", icon(route() === "/" ? "squares-four" : "arrow-left") + (route() === "/" ? "实验室任务" : "返回对话"))}
    ${noticeButton(icon("clock-counter-clockwise"), "icon-button history", "历史记录尚未接通。演示内容不会保存为真实任务。")}
    <span class="avatar" aria-label="${demo ? "演示成员洛，非登录身份" : "尚未登录"}">${demo ? "洛" : "访"}</span></nav></header>
    <div class="mode-label">${demo ? "演示数据 · 尚未连接服务" : "尚未连接任务服务"}</div><main id="main" tabindex="-1"></main>
    <footer>${demo ? "演示数据 · 尚未连接服务" : "尚未连接任务服务"}</footer>
    ${
      demo
        ? `<details class="preview-tools"><summary>预览状态</summary><label>合成场景 <select id="scenario">${[
            ["default", "正常"],
            ["empty", "空数据"],
            ["loading", "加载中"],
            ["error", "失败"],
            ["long", "长标题"],
          ]
            .map(
              ([value, label]) =>
                `<option value="${value}" ${scenario() === value ? "selected" : ""}>${label}</option>`,
            )
            .join("")}</select></label><p>仅开发预览可见</p></details>`
        : ""
    }
    <dialog aria-labelledby="dialog-title"><h2 id="dialog-title">功能说明</h2><p id="dialog-copy"></p><form method="dialog"><button class="primary">知道了</button></form></dialog>`;
  document
    .querySelector(".history")
    ?.setAttribute("aria-label", "历史记录（尚未接通）");
  document
    .querySelector<HTMLSelectElement>("#scenario")
    ?.addEventListener("change", (event) => {
      const url = new URL(location.href);
      url.searchParams.set(
        "scenario",
        (event.target as HTMLSelectElement).value,
      );
      location.assign(url.href);
    });
}
function scenario() {
  return new URLSearchParams(location.search).get("scenario") || "default";
}
function message(text: string) {
  document.querySelector("#dialog-copy")!.textContent = text;
  document.querySelector("dialog")!.showModal();
}
function composer(compact = false) {
  return `<form class="composer ${compact ? "compact" : ""}"><label class="sr-only" for="request">描述你的需求</label>
    <textarea id="request" maxlength="4000" rows="${compact ? 1 : 3}" placeholder="${compact ? "想改分工、时间或要求，直接告诉我……" : "我有一份科研项目申请书要写……"}">${e(draft)}</textarea>
    <div class="composer-actions">${compact ? "" : noticeButton(icon("paperclip") + " 添加资料", "quiet", "资料上传尚未接通。请勿在演示中提交真实研究材料。")}<button class="primary" type="submit" ${compact ? 'aria-label="发送需求（尚未接通）"' : ""}>${compact ? icon("arrow-right") : "帮我理清"}</button></div></form>`;
}
function statusBlock(kind: string, text: string) {
  return `<section class="state-panel" ${kind === "error" ? 'role="alert"' : 'role="status"'}>${icon(kind === "loading" ? "hourglass" : kind === "error" ? "warning-circle" : "tray")}<h2>${kind === "loading" ? "正在读取任务" : kind === "error" ? "暂时无法读取" : "还没有可见任务"}</h2><p>${e(text)}</p>${kind === "error" ? '<button class="primary" data-retry>重新读取</button>' : ""}${kind === "empty" ? link("/", "从一句话开始", "button") : ""}</section>`;
}
function entry() {
  return `<section class="entry"><p class="eyebrow">从一件要完成的事开始</p><h1>今天，想把什么事情推进一步？</h1><p class="intro">说出目标，一起理清需要的人与智能体。</p>
    ${composer()}<div class="suggestions" aria-label="需求示例">${["科研论文", "科研项目", "知识产权", "实验与数据", "学生培养", "汇报事务"].map((label) => `<button data-prompt="${label}">${label}</button>`).join("")}</div><p class="hint">也可以直接描述任何其他任务</p>
    <p class="entry-limit">需求整理与资料上传尚未接通；输入内容仅保留在当前页面。</p>
    <div id="recent" class="recent" aria-live="polite">正在读取最近任务…</div></section>`;
}
function card(task: TaskCardView) {
  return `<article class="task-card"><div class="card-heading"><span class="tag">${e(task.category)}</span><span class="task-status">${e(task.state)}</span></div><h3>${link("/tasks/" + task.id, e(task.title))}</h3><p>${e(task.people)} · ${e(task.date)}</p>
    ${task.total ? `<p class="count">已验收 ${task.accepted} / ${task.total} 项</p><meter aria-label="已验收交付项数量，不代表工时进度" min="0" max="${task.total}" value="${task.accepted}"></meter>` : ""}
    ${task.note ? `<div class="card-note ${task.state === "受阻" ? "amber" : "green"}">${icon(task.state === "受阻" ? "clock" : "check-circle")}${e(task.note)}</div>` : ""}
    ${task.id === "patent" ? link("/tasks/patent", "查看要求 " + icon("arrow-up-right"), "card-link") : ""}</article>`;
}
function overview(view: PreviewView) {
  const visible = tasksInScope(view, scope);
  return `<section class="page"><div class="page-heading"><div><h1>实验室任务</h1><p class="intro">任务、人员和下一步，放在一起看。</p></div><span class="date">${e(view.dateLabel || "")}</span></div>
    <div class="scope" role="group" aria-label="任务范围"><button data-scope="lab" aria-pressed="${scope === "lab"}">实验室</button><button data-scope="mine" aria-pressed="${scope === "mine"}">我参与的</button><span>当前可见任务${scope === "mine" ? " · 演示成员洛" : ""}</span></div>
    ${
      visible.length
        ? `<div class="alert slim">${icon("warning-circle")}当前需协调：${
            visible
              .filter((t) => t.state === "受阻" || t.state === "待安排")
              .map((t) => e(t.title) + " · " + e(t.note || t.people))
              .join("；") || "暂无待协调事项"
          }</div>
    <div class="board">${["待安排", "进行中", "待验收", "已完成"]
      .map(
        (label, index) =>
          `<section class="column" aria-label="${label}"><h2>${label}<span>${visible.filter((t) => t.column === index).length}</span></h2>${
            visible
              .filter((t) => t.column === index)
              .map(card)
              .join("") || '<p class="column-empty">暂无任务</p>'
          }</section>`,
      )
      .join("")}</div>`
        : statusBlock(
            "empty",
            "当前范围内没有任务。服务接通后，这里会显示你有权查看的任务。",
          )
    }
    <section class="people"><div class="section-heading"><h2>人员安排</h2><span>可用时间由成员更新。</span></div>${view.members.length ? `<div class="table-wrap"><table><caption class="sr-only">成员承诺与可用时间</caption><thead><tr><th>成员</th><th>当前承诺</th><th>下一节点</th><th>可用情况</th></tr></thead><tbody>${view.members.map((m) => `<tr><th scope="row">${e(m.name)}</th><td>${e(m.commitment)}</td><td>${e(m.next)}</td><td>${e(m.availability)}</td></tr>`).join("")}</tbody></table></div><p class="fine">${e(view.availabilityCaption || "可用时间尚未更新")}</p>` : '<p class="fine">暂无成员承诺与可用时间。</p>'}</section>
    ${composer(true)}</section>`;
}
function detail(view: PreviewView, id: string) {
  const task = view.tasks.find((t) => t.id === id);
  if (!task)
    return `<section class="page">${link("/lab", icon("arrow-left") + " 实验室任务", "back")}${statusBlock("empty", "未找到此任务，或你无权查看。")}</section>`;
  const proposal = task.detail;
  return `<section class="page detail">${link("/lab", icon("arrow-left") + " 实验室任务", "back")}<span class="tag">${e(task.category)}</span><h1>${e(task.title)}</h1><p class="intro">${proposal ? e(proposal.people) : e(task.people) + " · " + e(task.date)}</p>
    <p class="summary">${proposal ? e(proposal.summary) : e(task.state) + " · " + (task.note ? e(task.note) : "详细协作方案尚未安排。")}</p>
    ${proposal ? `<div class="alert">${icon("warning-circle")}<div><strong>当前卡点：${e(proposal.blocker)}</strong><p>${e(proposal.next)}</p></div>${noticeButton("确认研究主线", "primary", "方案确认将在 F1 实现。本预览不会修改状态或触发智能体。")}</div>` : ""}
    <h2>协作进度</h2>${proposal ? `<div class="table-wrap"><table class="steps"><caption class="sr-only">项目申请书协作环节与交付物</caption><thead><tr><th>环节与交付物</th><th>执行者</th><th>计划节点</th><th>状态</th></tr></thead><tbody>${view.steps.map((step) => `<tr><th scope="row">${e(step.title)}<small>${e(step.output)}</small></th><td>${e(step.actor)}</td><td>${e(step.date)}</td><td class="${step.tone}">${icon(step.tone === "amber" ? "warning-circle" : step.state.startsWith("已完成") ? "check-circle" : "clock")} ${e(step.state)}</td></tr>`).join("")}</tbody></table></div><p class="fine">${e(proposal.dependency)}</p>` : '<p class="fine empty-detail">此任务暂无可预览的协作环节。不会从其他任务复制进度。</p>'}
    <div class="detail-bottom"><section><h2>已有交付</h2>${proposal ? `<div class="delivery">${icon("file-text")}<div><strong>${e(proposal.deliverable)}</strong><p>${e(proposal.review)}</p></div>${noticeButton("查看 " + icon("caret-right"), "quiet", "此处仅展示合成的交付与验收状态。没有真实文件，未进行文献检索或引用验证。")}</div>` : '<p class="fine">暂无可预览的交付文件。</p>'}</section><section><h2>最近更新</h2><p>${proposal ? e(proposal.update) : "暂无更新记录"}</p>${proposal ? `<p class="fine">${e(proposal.updatedAt)}</p>` : ""}</section></div>
    ${composer(true)}<p class="fine">改动会先形成建议，确认后再更新安排。此功能尚未接通。</p></section>`;
}
function wire() {
  document.querySelector<HTMLButtonElement>("[data-skip]")!.onclick = () =>
    document.querySelector<HTMLElement>("main")?.focus();
  document.querySelectorAll<HTMLElement>(".table-wrap").forEach((el) => {
    el.tabIndex = 0;
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "数据表，可左右滚动");
  });
  document.querySelectorAll<HTMLFormElement>(".composer").forEach((form) => {
    form.onsubmit = (event) => {
      event.preventDefault();
      message(
        "需求整理尚未接通，未生成方案或创建任务。你的输入仍保留在当前页面。",
      );
    };
    form.querySelector("textarea")!.oninput = (event) => {
      draft = (event.target as HTMLTextAreaElement).value;
    };
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-notice]")
    .forEach((button) => {
      button.type = "button";
      button.onclick = () => message(button.dataset.notice!);
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-prompt]")
    .forEach((button) => {
      button.onclick = () => {
        const textarea = document.querySelector("textarea")!;
        draft = `我想推进一项${button.dataset.prompt}任务：`;
        textarea.value = draft;
        textarea.focus();
      };
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-scope]")
    .forEach((button) => {
      button.onclick = () => {
        scope = button.dataset.scope!;
        renderView();
        document
          .querySelector<HTMLButtonElement>(`[data-scope="${scope}"]`)
          ?.focus();
      };
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-retry]")
    .forEach((button) => {
      button.onclick = () => {
        void render();
      };
    });
}
function renderView() {
  const main = document.querySelector("main")!;
  if (route() === "/") {
    const recent = document.querySelector("#recent")!;
    const task = data ? tasksInScope(data, "mine")[0] : undefined;
    recent.innerHTML = task
      ? `<span>继续上次的事</span>${link("/tasks/" + encodeURIComponent(task.id), e(task.title) + " · " + e(task.state) + " " + icon("arrow-right"))}`
      : "暂无最近任务";
  } else if (route() === "/lab") main.innerHTML = overview(data!);
  else if (route().startsWith("/tasks/"))
    main.innerHTML = detail(data!, route().slice(7));
  else
    main.innerHTML = `<section class="page">${statusBlock("empty", "这个页面尚不存在。")}${link("/", "返回对话", "button")}</section>`;
  wire();
}
async function render() {
  pending?.abort();
  pending = new AbortController();
  const current = pending;
  data = undefined;
  shell();
  const main = document.querySelector("main")!;
  const title =
    route() === "/"
      ? "需求入口"
      : route() === "/lab"
        ? "实验室任务"
        : "任务详情";
  document.title = `${title} · Research Agent Platform`;
  main.innerHTML =
    route() === "/"
      ? entry()
      : `<section class="page">${link("/", "返回对话", "back")}${statusBlock("loading", "正在读取当前可见内容…")}</section>`;
  wire();
  if (activeRoute && activeRoute !== route()) {
    main.focus();
    window.scrollTo(0, 0);
  }
  activeRoute = route();
  try {
    const adapter = demo
      ? (await import("./fixture-adapter")).createFixtureAdapter(scenario())
      : unavailableAdapter;
    const result = await adapter.read(current.signal);
    if (current.signal.aborted) return;
    data = result;
    renderView();
  } catch (error) {
    if (current.signal.aborted) return;
    const text = error instanceof Error ? error.message : "读取失败，请重试。";
    if (route() === "/")
      document.querySelector("#recent")!.innerHTML =
        `<span role="status">${e(text)}</span><button data-retry>重新读取</button>`;
    else
      main.innerHTML = `<section class="page">${link("/lab", "实验室任务", "back")}${statusBlock("error", text)}</section>`;
    wire();
  }
}
window.addEventListener("hashchange", () => {
  void render();
});
void render();
