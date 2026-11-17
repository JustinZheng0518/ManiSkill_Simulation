"""Generate ManiSkill grasp rollouts and a per-width report for the dashboard."""
import argparse
import csv
import json
import math
import os
from pathlib import Path

WORKSPACE = Path("/workspace")
VULKAN = WORKSPACE / ".maniskill-vulkan/lvp_icd.json"
if VULKAN.is_file():
    os.environ.setdefault("VK_DRIVER_FILES", str(VULKAN))
os.environ.setdefault("MPLCONFIGDIR", "/tmp/maniskill-matplotlib")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/maniskill-cache")

import gymnasium as gym
import numpy as np
import sapien
import torch
from mani_skill.envs.tasks.tabletop.pick_cube import PickCubeEnv
from mani_skill.examples.motionplanning.base_motionplanner.utils import (
    compute_grasp_info_by_obb,
    get_actor_obb,
)
from mani_skill.utils.building import actors
from mani_skill.utils.registration import register_env
from mani_skill.utils.scene_builder.table import TableSceneBuilder

WIDTHS = (24, 36, 48, 60)
OBJECT_MASS_KG = 0.05
LIFT_M = 0.10
HOLD_S = 0.50
HORIZON = 160
LINKS = [f"panda_link{i}" for i in range(8)] + [
    "panda_hand", "panda_leftfinger", "panda_rightfinger",
]


@register_env("SizeAdaptiveGrasp-v1", max_episode_steps=HORIZON)
class SizeAdaptiveGrasp(PickCubeEnv):
    def __init__(self, width_mm, num_envs=1, **kwargs):
        if num_envs != 1 or width_mm <= 0:
            raise ValueError("The benchmark requires one environment and a positive object width")
        self.width_mm = width_mm
        super().__init__(num_envs=num_envs, **kwargs)

    def _load_scene(self, options):
        self.cube_half_size = self.width_mm / 2000
        self.table_scene = TableSceneBuilder(self, robot_init_qpos_noise=self.robot_init_qpos_noise)
        self.table_scene.build()
        builder = self.scene.create_actor_builder()
        dimensions = [self.cube_half_size] * 3
        density = OBJECT_MASS_KG / (self.width_mm / 1000) ** 3
        builder.add_box_collision(half_size=dimensions, density=density)
        builder.add_box_visual(
            half_size=dimensions,
            material=sapien.render.RenderMaterial(base_color=[0.92, 0.48, 0.14, 1]),
        )
        builder.set_initial_pose(sapien.Pose([0, 0, self.cube_half_size]))
        self.cube = builder.build(name="cube")
        self.goal_site = actors.build_sphere(
            self.scene, radius=self.goal_thresh, color=[0, 1, 0, 1],
            name="goal_site", body_type="kinematic", add_collision=False,
            initial_pose=sapien.Pose(),
        )
        self._hidden_objects.append(self.goal_site)

    def reset(self, **kwargs):
        self.stable_steps = 0
        return super().reset(**kwargs)

    def evaluate(self):
        grasped = self.agent.is_grasping(self.cube)
        lifted = self.clearance() >= LIFT_M
        success = torch.full_like(grasped, self.stable_steps >= self.hold_steps)
        return {"success": success, "is_grasped": grasped, "is_lifted": lifted}

    @property
    def hold_steps(self):
        return math.ceil(HOLD_S / self.control_timestep)

    def clearance(self):
        transform = self.cube.pose.to_transformation_matrix()
        # For a rotated cube, project its three half-axes onto world Z.
        vertical_extent = transform[:, 2, :3].abs().sum(dim=1) * self.cube_half_size
        return transform[:, 2, 3] - vertical_extent

    def _after_control_step(self):
        stable = self.agent.is_grasping(self.cube) & (self.clearance() >= LIFT_M)
        self.stable_steps = self.stable_steps + 1 if stable.item() else 0


class EpisodeEnded(Exception):
    """The grasp succeeded or used the full control-step budget."""


def pose_values(pose):
    return [round(float(value), 5) for value in pose.raw_pose[0]]


class ReplayRecorder(gym.Wrapper):
    def __init__(self, env):
        super().__init__(env)
        self.frames = []
        self.phase = "approach"
        self.success = False
        self.reason = "ik_failed"
        self.links = {link.name: link for link in env.unwrapped.agent.robot.links}

    def capture(self):
        base = self.unwrapped
        self.frames.append({
            "robot": [pose_values(self.links[name].pose) for name in LINKS],
            "object": pose_values(base.cube.pose),
            "phase": self.phase,
            "hold": base.stable_steps,
        })

    def step(self, action):
        transition = super().step(action)
        self.capture()
        _, _, done, limit, _ = transition
        if done.item() or bool(limit):
            self.success = done.item()
            self.reason = "success" if self.success else "timeout"
            raise EpisodeEnded
        return transition


def run_episode(env, seed):
    rollout = ReplayRecorder(env)
    rollout.reset(seed=seed)
    rollout.capture()
    base = rollout.unwrapped
    robot = base.agent.robot
    model = robot.create_pinocchio_model()
    tcp_index = base.agent.tcp.index.item()
    arm_mask = np.array([1] * 7 + [0, 0], dtype=np.int32)
    initial = base.cube.pose.sp.p
    approaching = np.array([0, 0, -1])
    closing_hint = base.agent.tcp.pose.to_transformation_matrix()[0, :3, 1].numpy()
    grasp_info = compute_grasp_info_by_obb(
        get_actor_obb(base.cube), approaching, target_closing=closing_hint, depth=0.025,
    )
    grasp = base.agent.build_grasp_pose(approaching, grasp_info["closing"], initial)

    def move(target, gripper, steps):
        start = robot.get_qpos()[0].numpy()
        local_target = robot.pose.sp.inv() * target
        joints, success, _ = model.compute_inverse_kinematics(
            tcp_index, local_target, initial_qpos=start,
            active_qmask=arm_mask, max_iterations=150,
        )
        if not success:
            return False
        for fraction in np.linspace(0, 1, steps + 1)[1:]:
            blend = fraction * fraction * (3 - 2 * fraction)
            qpos = start[:7] + (joints[:7] - start[:7]) * blend
            rollout.step(np.r_[qpos, gripper])
        return True

    def hold(gripper, steps):
        qpos = robot.get_qpos()[0, :7].numpy()
        for _ in range(steps):
            rollout.step(np.r_[qpos, gripper])

    try:
        above = grasp * sapien.Pose([0, 0, -0.07])
        if move(above, 1, 42):
            rollout.phase = "align"
            if move(grasp, 1, 24):
                rollout.phase = "grasp"
                hold(-1, 12)
                rollout.phase = "lift"
                lifted_pose = sapien.Pose(initial + [0, 0, LIFT_M + 0.04], grasp.q)
                if move(lifted_pose, -1, 32):
                    rollout.phase = "hold"
                    hold(-1, base.hold_steps)
                    rollout.reason = "unstable_grasp"
    except EpisodeEnded:
        pass

    return {
        "seed": seed, "success": rollout.success, "reason": rollout.reason,
        "frames": rollout.frames, "step_seconds": base.control_timestep,
    }


def wilson(successes, n):
    p = successes / n
    z = 1.95996398454
    center = (p + z*z / (2*n)) / (1 + z*z/n)
    margin = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / (1 + z*z/n)
    return [round(max(0, center-margin), 5), round(min(1, center+margin), 5)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=12, help="number of shared scene seeds")
    parser.add_argument("--seed", type=int, default=700)
    parser.add_argument("--output", type=Path, default=Path("public/data"))
    args = parser.parse_args()
    if args.trials < 1 or args.seed < 0:
        parser.error("trials must be positive and seed must be nonnegative")
    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(1)
    report = {
        "task": "SizeAdaptiveGrasp-v1", "simulator": "ManiSkill 3.0.1",
        "control_mode": "pd_joint_pos", "lift_m": LIFT_M, "hold_s": HOLD_S,
        "horizon": HORIZON, "mass_kg": OBJECT_MASS_KG, "trials_per_width": args.trials, "seed_start": args.seed,
        "links": LINKS,
        "groups": [
            {"id": "script", "label": "脚本策略"},
            {"id": "public", "label": "仅公开数据"},
            {"id": "augmented", "label": "公开 + 自有数据"},
        ],
        "widths": [],
    }
    raw = []
    for width in WIDTHS:
        env = gym.make(
            "SizeAdaptiveGrasp-v1", width_mm=width, obs_mode="state",
            render_backend="cpu", sim_backend="cpu", control_mode="pd_joint_pos",
            reward_mode="none", robot_init_qpos_noise=0,
        )
        first = None
        passed = 0
        try:
            for seed in range(args.seed, args.seed + args.trials):
                episode = run_episode(env, seed)
                episode["width_mm"] = width
                passed += int(episode["success"])
                raw.append({
                    "width_mm": width, "policy": "script", "seed": seed,
                    "success": int(episode["success"]), "outcome": episode["reason"],
                    "steps": len(episode["frames"]) - 1,
                })
                if first is None:
                    first = episode
                print(f"{width} mm, seed {seed}: {episode['reason']}", flush=True)
        finally:
            env.close()
        filename = f"replay-{width}.json"
        (args.output / filename).write_text(json.dumps(first, separators=(",", ":")))
        report["widths"].append({
            "width_mm": width, "replay": filename,
            "results": {
                "script": {"successes": passed, "n": args.trials, "ci": wilson(passed, args.trials)},
                "public": None, "augmented": None,
            },
        })
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (args.output / "trials.csv").open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(raw[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(raw)


if __name__ == "__main__":
    main()
