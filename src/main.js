import "./style.css";
import { createViewer } from "./scene.js";

const byId = (id) => document.getElementById(id);
const seek = byId("seek");
const play = byId("play");
const speed = byId("speed");
const phase = byId("phase");
const panel = byId("replay");
const outsidePanel = document.querySelectorAll(".topbar, main > :not(#replay)");
const presentButton = byId("present");
const exitButton = byId("exit-presentation");
const closeUpButton = byId("close-up");
const liveButton = byId("run-live");
const appRoot = new URL(import.meta.env.BASE_URL, document.baseURI);
const phases = { approach: "接近物体", align: "对准夹爪", grasp: "闭合夹爪", lift: "抬升物体", hold: "稳定保持" };
const percent = (value) => (value * 100).toFixed(1) + "%";

let viewer;
let widths = [];
let activeIndex = 0;
let replay;
let progress = 0;
let playing = false;
let previousTime;
let selection = 0;
let presenting = false;
let cycleAt = null;
let nativeFullscreen = false;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status + " " + url);
  return response.json();
}

function getData(name) {
  return window.GRASP_DATA?.[name] ?? fetchJson(new URL("data/" + name, appRoot));
}

async function enableLiveSimulation() {
  if (window.GRASP_DATA) return;
  try {
    const capability = await fetchJson(new URL("api/health", appRoot));
    liveButton.hidden = capability.simulator !== "ManiSkill";
  } catch {
    // Static hosting provides the recorded rollouts.
  }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setPlaying(flag) {
  playing = flag;
  play.textContent = flag ? "❚❚" : "▶";
  play.setAttribute("aria-label", flag ? "暂停回放" : "播放回放");
}

function paint() {
  if (!replay) return;
  const index = Math.floor(progress);
  const last = replay.frames.length - 1;
  const frame = replay.frames[index];
  viewer.frame(frame, replay.frames[Math.min(index + 1, last)], progress - index);
  seek.value = progress;
  byId("elapsed").textContent = (progress * replay.step_seconds).toFixed(2) + " s";
  const complete = index === last;
  phase.dataset.outcome = complete ? (replay.success ? "success" : "failure") : "";
  phase.textContent = complete
    ? (replay.success ? "抓取成功" : "抓取未成功")
    : (frame.hold ? phases.hold : phases[frame.phase]);
}

function animate(now) {
  if (playing && replay) {
    const delta = previousTime === undefined ? 0 : Math.min((now - previousTime) / 1000, .1);
    const last = replay.frames.length - 1;
    progress = Math.min(last, progress + delta * Number(speed.value) / replay.step_seconds);
    paint();
    if (progress >= last) {
      setPlaying(false);
      if (presenting) cycleAt = now + 1550;
    }
  } else if (cycleAt !== null && now >= cycleAt) {
    cycleAt = null;
    loadReplay((activeIndex + 1) % widths.length, { autoplay: true });
  }
  previousTime = now;
  requestAnimationFrame(animate);
}

function showError(message, error) {
  byId("error").textContent = message;
  byId("error").hidden = false;
  console.error(error);
}

function showReplayStatus() {
  const width = widths[activeIndex].width_mm;
  byId("stage-width").textContent = width + " mm";
  byId("stage-seed").textContent = "Seed " + replay.seed + " / 脚本策略";
  for (const button of byId("sizes").children) {
    button.setAttribute("aria-pressed", button.dataset.width === String(width));
  }
  for (const row of byId("results-body").rows) {
    row.classList.toggle("selected", row.dataset.width === String(width));
  }
}

async function loadReplay(index, { autoplay = false, fresh = false } = {}) {
  const request = ++selection;
  const condition = widths[index];
  cycleAt = null;
  setPlaying(false);
  play.disabled = seek.disabled = liveButton.disabled = presentButton.disabled = true;
  byId("error").hidden = true;
  byId("stage-width").textContent = condition.width_mm + " mm";
  byId("stage-seed").textContent = fresh ? "正在运行新的 ManiSkill 仿真…" : "正在读取轨迹";
  try {
    let result;
    if (fresh) {
      const url = new URL("api/rollout", appRoot);
      url.search = new URLSearchParams({
        width: condition.width_mm,
        seed: (replay.seed + 1) % (2 ** 31),
      });
      result = await fetchJson(url);
    } else {
      result = await getData(condition.replay);
    }
    if (request !== selection) return;
    replay = result;
    activeIndex = index;
    progress = 0;
    seek.max = result.frames.length - 1;
    seek.step = ".01";
    viewer.setWidth(condition.width_mm);
    showReplayStatus();
    byId("source-label").textContent = fresh ? "本次生成的 ManiSkill 轨迹" : "ManiSkill 轨迹回放";
    byId("duration").textContent = ((result.frames.length - 1) * result.step_seconds).toFixed(2) + " s";
    paint();
    setPlaying(autoplay);
  } catch (error) {
    if (request !== selection) return;
    if (replay) showReplayStatus();
    showError(fresh ? "新仿真运行失败，请查看仿真服务日志。" : "轨迹加载失败，请重试或切换尺寸。", error);
  } finally {
    if (request === selection && replay) {
      play.disabled = seek.disabled = liveButton.disabled = presentButton.disabled = false;
    }
  }
}

function setCamera(closeUp) {
  viewer.setCamera(closeUp);
  closeUpButton.setAttribute("aria-pressed", closeUp);
}

function endPresentation() {
  if (!presenting) return;
  presenting = false;
  nativeFullscreen = false;
  cycleAt = null;
  setPlaying(false);
  panel.classList.remove("presentation");
  document.body.classList.remove("presenting");
  exitButton.hidden = true;
  outsidePanel.forEach((element) => { element.inert = false; });
  if (document.fullscreenElement === panel) document.exitFullscreen().catch(() => {});
  presentButton.focus();
}

function startPresentation(requestFullscreen) {
  if (!replay || presenting) return;
  presenting = true;
  panel.classList.add("presentation");
  document.body.classList.add("presenting");
  exitButton.hidden = false;
  outsidePanel.forEach((element) => { element.inert = true; });
  setCamera(false);
  progress = 0;
  paint();
  setPlaying(true);
  if (requestFullscreen && panel.requestFullscreen) {
    panel.requestFullscreen().then(() => {
      if (presenting) nativeFullscreen = document.fullscreenElement === panel;
      else if (document.fullscreenElement === panel) document.exitFullscreen().catch(() => {});
    }).catch(() => {});
  }
  exitButton.focus();
}

function resultCell(result) {
  const cell = document.createElement("td");
  if (result == null) {
    cell.append(node("span", "pending", "待测"));
    return cell;
  }
  cell.append(node("span", "rate", percent(result.successes / result.n)),
    node("small", "table-meta", result.successes + " / " + result.n + " · [" +
      percent(result.ci[0]) + ", " + percent(result.ci[1]) + "]"));
  return cell;
}

function renderReport(report) {
  let successes = 0;
  let total = 0;
  for (const condition of report.widths) {
    const row = document.createElement("tr");
    row.dataset.width = condition.width_mm;
    const width = node("th", "", condition.width_mm + " mm");
    width.scope = "row";
    row.append(width, ...report.groups.map((group) => resultCell(condition.results[group.id])));
    const { script, public: baseline, augmented } = condition.results;
    const delta = baseline && augmented
      ? ((augmented.successes / augmented.n - baseline.successes / baseline.n) * 100).toFixed(1) + " pp"
      : "—";
    row.append(node("td", "pending", delta));
    byId("results-body").append(row);
    successes += script.successes;
    total += script.n;
  }

  const stats = [
    ["测试尺寸", String(report.widths.length)],
    ["脚本试验数", String(total)],
    ["脚本抓取成功率", percent(successes / total)],
  ];
  if (report.widths.every(({ results }) => results.public && results.augmented)) {
    byId("comparison-status").textContent = "提升以百分点（pp）表示。";
  }
  for (const [label, number] of stats) {
    const stat = node("div", "stat");
    stat.append(node("div", "", label), node("strong", "", number));
    byId("stats").append(stat);
  }
  byId("protocol-success").textContent = "抬离桌面至少 " + report.lift_m * 100 +
    " cm，持续夹持至少 " + report.hold_s.toFixed(2) + " s，限 " + report.horizon + " 个控制步。";
  byId("protocol-seeds").textContent = "各宽度共用 " + report.trials_per_width +
    " 个场景种子（" + report.seed_start + "–" + (report.seed_start + report.trials_per_width - 1) +
    "），随机化初始位置和朝向，物体质量固定为 " + report.mass_kg * 1000 + " g。";
}

async function initialize() {
  try {
    const report = await getData("report.json");
    renderReport(report);
    viewer = await createViewer(byId("viewport"), report.links);
    widths = report.widths;
    widths.forEach((condition, index) => {
      const button = node("button", "size", condition.width_mm + " mm");
      button.type = "button";
      button.dataset.width = condition.width_mm;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => loadReplay(index, { autoplay: presenting }));
      byId("sizes").append(button);
    });
    byId("reset-view").addEventListener("click", () => setCamera(false));
    closeUpButton.addEventListener("click", () => setCamera(closeUpButton.getAttribute("aria-pressed") !== "true"));
    closeUpButton.disabled = byId("reset-view").disabled = false;
    await loadReplay(Math.max(0, widths.findIndex((condition) => condition.width_mm === 48)));
    enableLiveSimulation();
    if (new URLSearchParams(location.search).get("present") === "1") startPresentation(false);
    requestAnimationFrame(animate);
  } catch (error) {
    showError("3D 视图加载失败。请确认浏览器支持 WebGL 2 并允许加载本地资源。", error);
  }
}

play.addEventListener("click", () => {
  if (!replay) return;
  cycleAt = null;
  if (!playing && progress >= replay.frames.length - 1) progress = 0;
  setPlaying(!playing);
  paint();
});
seek.addEventListener("input", () => {
  cycleAt = null;
  setPlaying(false);
  progress = Number(seek.value);
  paint();
});
presentButton.addEventListener("click", () => startPresentation(true));
exitButton.addEventListener("click", endPresentation);
liveButton.addEventListener("click", () => loadReplay(activeIndex, { fresh: true, autoplay: true }));
document.addEventListener("fullscreenchange", () => {
  if (nativeFullscreen && document.fullscreenElement !== panel) endPresentation();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && presenting) endPresentation();
});
initialize();
