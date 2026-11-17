# Size-Adaptive Grasp Lab

An interactive 3D viewer and benchmark for a Franka Panda picking up objects of different widths in ManiSkill. The viewer applies the measured robot link and object poses to a Three.js scene. The physics task uses ManiSkill's flat tabletop and a 50 g cube. The kitchen counter and props are part of the presentation.

## Show the grasp to an audience

With Node.js 22.12 or newer, run these commands from the repository root:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Click **开始演示** (Start presentation) for a full-window view that plays each grasp and cycles through the four widths. Use **夹爪特写** (Gripper close-up) to see the fingers close around the cube. You can also drag to orbit, scroll to zoom, change playback speed, or scrub the timeline. Press Escape or click **退出演示** to return to the results table. Add `?present=1` to the viewer URL to start in presentation mode.

To bring a single HTML file to a talk, build and export the viewer. The HTML contains the meshes and recorded rollouts and opens in a WebGL 2 browser without a server.

```sh
npm run build
python export_demo.py grasp-lab.html
```

## Run a fresh simulation

In the configured Codex cloud environment, build the viewer and start the ManiSkill server:

```sh
npm ci
npm run build
/workspace/.maniskill-venv/bin/python simulate.py
```

Open `http://127.0.0.1:4173/` in a browser on the same machine. Select a width and click **运行新仿真** (Run fresh simulation). ManiSkill runs the scripted grasp with a new scene seed, then the browser plays the resulting trajectory. The new episode stays separate from the benchmark results. On another machine with Python 3.12, ManiSkill 3.0.1 and a working Vulkan driver, replace the cloud Python path with your own Python executable.

## Reproduce the benchmark

```sh
/workspace/.maniskill-venv/bin/python benchmark.py --trials 12 --seed 700
```

- The Panda uses `pd_joint_pos`. The cube widths are 24, 36, 48 and 60 mm. All widths use the same 12 scene seeds, which randomize the initial position and yaw.
- A grasp succeeds if the lowest point of the cube is lifted at least 10 cm above the table and the gripper maintains contact for at least 0.50 seconds, within 160 control steps.
- The feasibility check uses an inverse-kinematics script with access to the true object pose. All 48 recorded trials succeeded. The learned policies trained on public data and on public plus project data are pending.
- `public/data/trials.csv` contains per-trial outcomes. `public/data/report.json` contains counts and Wilson 95% confidence intervals by width. The `replay-*.json` files contain a trajectory for the same seed at each width.

Evaluate both learned policies on the same held-out widths and scene seeds, with the same observation and action spaces and success criterion. Add each policy's `successes`, `n` and interval `ci` to the `public` and `augmented` entries in `report.json`. The table computes the difference in percentage points. For a research report, also record training seeds and use a paired interval for the difference on matched scenes.
