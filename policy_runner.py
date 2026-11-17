"""Load trusted model checkpoints and evaluate them on the benchmark task."""
from dataclasses import dataclass
from importlib import import_module
import json
from pathlib import Path
import re
from typing import Callable

from benchmark import HORIZON, ReplayRecorder, make_env, torch


@dataclass
class Model:
    label: str
    policy: Callable


def load_models(config: Path | None) -> dict[str, Model]:
    if config is None:
        return {}
    entries = json.loads(config.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError("The model configuration must be a JSON array.")

    models = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Each model configuration entry must be an object.")
        model_id = entry.get("id", "")
        if not isinstance(model_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", model_id):
            raise ValueError("Each model needs an id of letters, digits, underscores or hyphens.")
        if model_id in models:
            raise ValueError(f"Duplicate model id: {model_id}")
        label = entry.get("label", model_id)
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"Model {model_id} needs a nonempty label.")
        checkpoint = (config.parent / entry["checkpoint"]).resolve(strict=True)
        if not checkpoint.is_file():
            raise ValueError(f"Model {model_id} needs a checkpoint file.")

        factory = entry.get("factory")
        if factory:
            module, name = factory.split(":", 1)
            model = getattr(import_module(module), name)(checkpoint)
        else:
            model = torch.jit.load(str(checkpoint), map_location="cpu").eval()

        if not callable(model):
            raise TypeError(f"Model {model_id} must be a callable policy.")
        models[model_id] = Model(label, model)
    return models


def evaluate_policy(policy, env, seed):
    recorder = ReplayRecorder(env)
    recorder.phase = "control"
    base = env.unwrapped
    obs, _ = recorder.reset(seed=seed)
    recorder.capture()
    reset = getattr(policy, "reset", None)
    if callable(reset):
        reset()

    max_clearance = 0.0
    max_hold = 0
    ever_grasped = False
    success = False
    shape = base.single_action_space.shape
    for _ in range(HORIZON):
        with torch.inference_mode():
            action = torch.as_tensor(policy(obs), dtype=torch.float32, device=base.device)
        if action.shape not in (shape, (1, *shape)) or not torch.isfinite(action).all():
            raise ValueError(f"Policy must return finite actions of shape {shape} or {(1, *shape)}.")

        obs, _, terminated, truncated, info = env.step(action.clone())
        grasped = bool(info["is_grasped"].item())
        ever_grasped |= grasped
        max_clearance = max(max_clearance, base.clearance().item())
        max_hold = max(max_hold, base.stable_steps)
        recorder.phase = "lift" if grasped else "control"
        recorder.capture()

        success = bool(info["success"].item())
        if bool(terminated) or bool(truncated):
            break

    if success:
        reason = "success"
    elif not ever_grasped:
        reason = "no_grasp"
    elif max_hold == 0:
        reason = "not_lifted"
    else:
        reason = "unstable_hold"

    return {
        "seed": seed,
        "success": success,
        "reason": reason,
        "step_seconds": base.control_timestep,
        "steps": len(recorder.frames) - 1,
        "max_clearance_cm": round(max_clearance * 100, 2),
        "hold_seconds": round(max_hold * base.control_timestep, 3),
        "frames": recorder.frames,
    }


def run_model(model, width, seed, *, obs_mode, control_mode):
    env = make_env(width, obs_mode=obs_mode, control_mode=control_mode)
    try:
        return evaluate_policy(model.policy, env, seed)
    finally:
        env.close()
