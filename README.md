# Size-Adaptive Grasp Lab

An interactive 3D viewer and benchmark for a Franka Panda picking up objects of different widths in ManiSkill. The viewer applies the measured robot link and object poses to a Three.js scene. The physics task uses ManiSkill's flat tabletop and a 50 g cube. The kitchen counter and props are part of the presentation.

## Show the grasp to an audience

[Download the offline demo ZIP](https://raw.githubusercontent.com/JustinZheng0518/ManiSkill_Simulation/main/demo/Grasp-Lab.zip). Extract it, open `grasp-lab.html` in a WebGL 2 browser, and click **开始演示** (Start presentation). If your browser blocks local HTML, run `python open_demo.py` from the extracted folder and use the address it prints. The ZIP also includes an MP4 rendered by ManiSkill.

With Node.js 22.12 or newer, run these commands from the repository root:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Click **开始演示** (Start presentation) for a full-window view that plays each grasp and cycles through the four widths. Use **夹爪特写** (Gripper close-up) to see the fingers close around the cube. You can also drag to orbit, scroll to zoom, change playback speed, or scrub the timeline. Press Escape or click **退出演示** to return to the results table. Add `?present=1` to the viewer URL to start in presentation mode.

To regenerate the single-file viewer after making changes, build and export it. The HTML contains the meshes and recorded rollouts and opens in a WebGL 2 browser without a server.

```sh
npm run build
python export_demo.py grasp-lab.html
```

## Evaluate trained models in the browser

Save a local model registry as `policies.local.json` in the repository root. Each checkpoint path is relative to the registry file. This example registers two policies so they can be compared on the same width and seed:

```json
[
  {"id": "public", "label": "Public-data baseline", "checkpoint": "checkpoints/public.pt"},
  {"id": "augmented", "label": "Public + project data", "checkpoint": "checkpoints/augmented.pt"}
]
```

By default, the server loads each checkpoint as a CPU TorchScript policy. The model receives the batched ManiSkill `state` observation and returns one `pd_joint_pos` action. For the Panda this is seven target joint positions and a gripper command. Return a finite tensor in the environment's action space, with shape `(8,)` or `(1, 8)` for this control mode.

For a different checkpoint format or input preprocessing, add `"factory": "your_adapter:load_policy"` to a registry entry. The importable Python factory receives the checkpoint as a `pathlib.Path` and returns a callable `policy(observation)`. A stateful policy can expose `reset()`, which is called before the first action of each episode. Start the server with `--obs-mode` and `--control-mode` matching training. These settings apply to all registered models. Register trusted checkpoints and adapters from the server machine. The browser sends a registered model ID, width and seed.

In the configured cloud workspace, build the viewer and start the simulator server:

```sh
npm ci
npm run build
/workspace/.maniskill-venv/bin/python simulate.py --policy-config policies.local.json
```

Open the address printed by the server in a browser on the same machine. Select a trained model and a width in **训练模型测试** (Trained model test), then click **运行抓取** (Run grasp). Leave the seed blank for a random scene or reuse the same seed to compare models. ManiSkill runs a new episode, and the page plays its trajectory and records the verdict, peak lift clearance, and longest valid hold. Trials stay in the current browser page. The saved benchmark report is separate.

To run elsewhere, use a Python environment with ManiSkill 3.0.1, the model's dependencies, and a working Vulkan driver. The offline ZIP and Vite development server provide the prerecorded viewer. Run `simulate.py` for model inference.

## Reproduce the benchmark

```sh
/workspace/.maniskill-venv/bin/python benchmark.py --trials 12 --seed 700
```

- The Panda uses `pd_joint_pos`. The cube widths are 24, 36, 48 and 60 mm. All widths use the same 12 scene seeds, which randomize the initial position and yaw.
- A grasp succeeds if the lowest point of the cube is lifted at least 10 cm above the table and the gripper maintains contact for at least 0.50 seconds, within 160 control steps.
- The feasibility check uses an inverse-kinematics script with access to the true object pose. All 48 recorded trials succeeded. The learned policies trained on public data and on public plus project data are pending.
- `public/data/trials.csv` contains per-trial outcomes. `public/data/report.json` contains counts and Wilson 95% confidence intervals by width. The `replay-*.json` files contain a trajectory for the same seed at each width.

Evaluate both learned policies on the same held-out widths and scene seeds, with the same observation and action spaces and success criterion. Add each policy's `successes`, `n` and interval `ci` to the `public` and `augmented` entries in `report.json`. The table computes the difference in percentage points. For a research report, also record training seeds and use a paired interval for the difference on matched scenes.
