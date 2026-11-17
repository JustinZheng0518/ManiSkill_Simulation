const byId = (id) => document.getElementById(id);
const reasons = {
  no_grasp: "未抓住物体",
  not_lifted: "夹持时未达到抬升高度",
  unstable_hold: "保持时间不足",
};

function addTrial(result) {
  const row = byId("test-results-body").insertRow(0);
  for (const value of [
    result.policy_label,
    result.width_mm + " mm",
    String(result.seed),
    result.success ? "成功" : "失败 · " + reasons[result.reason],
    result.max_clearance_cm.toFixed(2) + " cm",
    result.hold_seconds.toFixed(2) + " s",
  ]) {
    row.insertCell().textContent = value;
  }
  row.cells[3].classList.add(result.success ? "trial-success" : "trial-failure");
  byId("test-results").hidden = false;
}

export async function initModelTest({ widths, appRoot, showRollout }) {
  const model = byId("model-select");
  const width = byId("test-width");
  const seed = byId("test-seed");
  const run = byId("run-model");
  const status = byId("test-status");
  const connection = byId("model-connection");
  for (const condition of widths) {
    width.add(new Option(condition.width_mm + " mm", condition.width_mm));
  }
  width.disabled = false;
  let capability;
  if (!window.GRASP_DATA) {
    try {
      const response = await fetch(new URL("api/health", appRoot));
      if (response.ok) capability = await response.json();
    } catch {
      // The static viewer remains usable when the simulator is unavailable.
    }
  }
  if (capability?.simulator !== "ManiSkill") {
    connection.textContent = "仿真服务未连接";
    model.options[0].textContent = "需要连接模型服务";
    status.textContent = "请通过 simulate.py 启动网页以运行训练模型。";
    return;
  }
  if (!capability.policies?.length) {
    connection.textContent = "已连接 ManiSkill";
    model.options[0].textContent = "暂无训练模型";
    status.textContent = "仿真服务已连接。加载训练权重后即可选择模型并运行抓取。";
    return;
  }

  connection.textContent = "ManiSkill 已连接";
  model.replaceChildren(...capability.policies.map((entry) => new Option(entry.label, entry.id)));
  model.disabled = run.disabled = false;
  byId("policy-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (run.disabled) return;
    const caseSeed = seed.value === "" ? Math.floor(Math.random() * 2 ** 31) : seed.valueAsNumber;
    const caseWidth = Number(width.value);
    const modelName = model.selectedOptions[0].textContent;
    model.disabled = width.disabled = seed.disabled = run.disabled = true;
    status.textContent = "ManiSkill 正在运行 " + modelName + " · " + caseWidth + " mm · Seed " + caseSeed;
    status.removeAttribute("data-outcome");
    try {
      const response = await fetch(new URL("api/policy-rollout", appRoot), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: model.value, width: caseWidth, seed: caseSeed }),
      });
      if (!response.ok) throw new Error("Policy rollout HTTP " + response.status);
      const result = await response.json();
      const outcome = result.success ? "抓取成功" : "抓取失败 · " + reasons[result.reason];
      status.textContent = outcome + " · " + result.width_mm + " mm · Seed " + result.seed;
      status.dataset.outcome = result.success ? "success" : "failure";
      addTrial(result);
      showRollout(result);
    } catch (error) {
      status.textContent = "模型评测未完成，请查看仿真服务日志。";
      console.error(error);
    } finally {
      model.disabled = width.disabled = seed.disabled = run.disabled = false;
    }
  });
}
