# 尺寸自适应抓取实验台

浏览器界面使用 Three.js 回放 ManiSkill 的 Franka Panda 关节位姿和物体位姿。厨房道具和台面造型用于展示。仿真试验使用 ManiSkill 的标准平面工作台，物体为 50 g 立方体。

## 复现评测和界面

在已配置 ManiSkill 3.0.1 的云端工作区中，从本仓库目录运行：

```sh
/workspace/.maniskill-venv/bin/python benchmark.py --trials 12 --seed 700
npm ci
npm run dev
```

开发服务器默认监听 5173 端口。生成可离线打开的单文件演示：

```sh
npm run build
python export_demo.py /workspace/shared/downloads/grasp-lab.html
```

## 评测口径

- Panda 使用 `pd_joint_pos`。测试宽度为 24、36、48 和 60 mm。每个宽度使用相同的 12 个场景种子，随机化物体的初始位置及偏航。
- 夹爪在 160 个控制步之内，将立方体最低点抬离桌面至少 10 cm，并连续保持有效抓取至少 0.50 s，即判为成功。
- 目前运行的是可读取物体真实位姿的逆运动学脚本，用于检查各尺寸下任务的可行性。它在所有跑过的尺寸和种子上成功。
- `public/data/trials.csv` 保留逐试验结果。`report.json` 保存成功数、分母和按尺寸计算的 Wilson 95% 置信区间。`replay-*.json` 各保存同一场景种子的一条轨迹。
- 公开数据训练组和公开＋自有数据训练组当前显示待测。后续在相同尺寸、种子、机械臂控制模式和成功判据下运行已训练策略；将每个尺寸对应的 `public` 与 `augmented` 结果填入报告。每个结果包含 `successes`、`n` 和比例值的 `ci`。表格会显示百分点差值。正式报告建议另记录训练种子，并对匹配场景的差值给出配对置信区间。
