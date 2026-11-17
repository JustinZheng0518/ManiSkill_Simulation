import "./style.css";
import { createViewer } from "./scene.js";

const byId = (id) => document.getElementById(id);
const seek = byId("seek");
const play = byId("play");
const speed = byId("speed");
const phase = byId("phase");
const dataUrl = (name) => new URL("data/" + name, new URL(import.meta.env.BASE_URL, document.baseURI));
const phases = { approach: "接近物体", align: "对准夹爪", grasp: "闭合夹爪", lift: "抬升物体", hold: "稳定保持" };
const percent = (value) => (value * 100).toFixed(1) + "%";

let viewer;
let replay;
let progress = 0;
let playing = false;
let previousTime;
let selection = 0;

async function getData(name) {
  if (window.GRASP_DATA?.[name]) return window.GRASP_DATA[name];
  const response = await fetch(dataUrl(name));
  if (!response.ok) throw new Error(response.status + " " + name);
  return response.json();
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
  phase.textContent = index === last
    ? (replay.success ? "抓取成功" : "抓取未成功")
    : phases[frame.phase];
}

function animate(now) {
  if (playing && replay) {
    const delta = previousTime === undefined ? 0 : Math.min((now - previousTime) / 1000, .1);
    const last = replay.frames.length - 1;
    progress = Math.min(last, progress + delta * Number(speed.value) / replay.step_seconds);
    paint();
    if (progress >= last) setPlaying(false);
  }
  previousTime = now;
  requestAnimationFrame(animate);
}

function showError(message, error) {
  byId("error").textContent = message;
  byId("error").hidden = false;
  console.error(error);
}

async function loadReplay(condition) {
  const request = ++selection;
  setPlaying(false);
  play.disabled = seek.disabled = true;
  byId("error").hidden = true;
  byId("stage-width").textContent = condition.width_mm + " mm";
  byId("stage-seed").textContent = "正在读取轨迹";
  for (const button of byId("sizes").children) {
    button.setAttribute("aria-pressed", button.dataset.width === String(condition.width_mm));
  }
  for (const row of byId("results-body").rows) {
    row.classList.toggle("selected", row.dataset.width === String(condition.width_mm));
  }
  try {
    const result = await getData(condition.replay);
    if (request !== selection) return;
    replay = result;
    progress = 0;
    seek.max = result.frames.length - 1;
    seek.step = ".01";
    viewer.setWidth(condition.width_mm);
    byId("stage-seed").textContent = "Seed " + result.seed + " / 脚本策略";
    byId("duration").textContent = ((result.frames.length - 1) * result.step_seconds).toFixed(2) + " s";
    play.disabled = seek.disabled = false;
    paint();
  } catch (error) {
    if (request === selection) showError("轨迹加载失败，请重试或切换尺寸。", error);
  }
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
    for (const condition of report.widths) {
      const button = node("button", "size", condition.width_mm + " mm");
      button.type = "button";
      button.dataset.width = condition.width_mm;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => loadReplay(condition));
      byId("sizes").append(button);
    }
    byId("reset-view").addEventListener("click", viewer.reset);
    await loadReplay(report.widths.find((condition) => condition.width_mm === 48) ?? report.widths[0]);
    requestAnimationFrame(animate);
  } catch (error) {
    showError("3D 视图加载失败。请确认浏览器支持 WebGL 2 并允许加载本地资源。", error);
  }
}

play.addEventListener("click", () => {
  if (!replay) return;
  if (!playing && progress >= replay.frames.length - 1) progress = 0;
  setPlaying(!playing);
  paint();
});
seek.addEventListener("input", () => {
  setPlaying(false);
  progress = Number(seek.value);
  paint();
});
initialize();
