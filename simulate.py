"""Serve the built viewer and run fresh ManiSkill grasp rollouts on request."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import traceback
from urllib.parse import parse_qs, urlsplit


class ViewerHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/api/health":
            self.send_json({
                "simulator": "ManiSkill",
                "widths": self.server.widths,
                "policies": [
                    {"id": model_id, "label": model.label}
                    for model_id, model in self.server.models.items()
                ],
            })
            return
        if url.path != "/api/rollout":
            super().do_GET()
            return

        query = parse_qs(url.query)
        try:
            width, = query["width"]
            seed, = query["seed"]
            width, seed = int(width), int(seed)
            if width not in self.server.widths or not 0 <= seed < 2**31:
                raise ValueError
        except (KeyError, ValueError):
            self.send_json({"error": "Supply a supported width and a valid scene seed."}, 400)
            return

        try:
            rollout = self.server.simulation.submit(self.server.rollout, width, seed).result()
        except Exception:
            self.log_error("ManiSkill rollout failed for width %s and seed %s", width, seed)
            traceback.print_exc()
            self.send_json({"error": "The ManiSkill rollout failed. See the server output."}, 500)
        else:
            self.send_json(rollout)

    def do_POST(self):
        if urlsplit(self.path).path != "/api/policy-rollout":
            self.send_json({"error": "Unknown endpoint."}, 404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096 or self.headers.get_content_type() != "application/json":
                raise ValueError
            request = json.loads(self.rfile.read(length))
            width, seed, model_id = request["width"], request["seed"], request["policy"]
            if type(width) is not int or width not in self.server.widths:
                raise ValueError
            if type(seed) is not int or not 0 <= seed < 2**31:
                raise ValueError
            if not isinstance(model_id, str) or model_id not in self.server.models:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            self.send_json({"error": "Supply an available model, supported width and valid seed."}, 400)
            return

        try:
            result = self.server.simulation.submit(
                self.server.policy_rollout, self.server.models[model_id], width, seed,
            ).result()
        except Exception:
            self.log_error("Policy rollout failed for %s, width %s and seed %s", model_id, width, seed)
            traceback.print_exc()
            self.send_json({"error": "Model evaluation failed. See the simulator log."}, 500)
            return

        self.send_json({
            "policy": model_id,
            "policy_label": self.server.models[model_id].label,
            "width_mm": width,
            **result,
        })

    def send_json(self, result, status=200):
        body = json.dumps(result, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--policy-config", type=Path, help="JSON list of checkpoints and optional Python adapters")
    parser.add_argument("--obs-mode", default="state", help="ManiSkill observation mode for all trained models")
    parser.add_argument("--control-mode", default="pd_joint_pos", help="ManiSkill control mode for all trained models")
    args = parser.parse_args()
    dist = Path(__file__).resolve().parent / "dist"
    if not (dist / "index.html").is_file():
        parser.error("Run npm ci and npm run build first.")

    from benchmark import WIDTHS, make_env, run_episode, torch
    from policy_runner import load_models, run_model

    torch.set_num_threads(1)

    def rollout(width, seed):
        env = make_env(width)
        try:
            return {"width_mm": width, **run_episode(env, seed)}
        finally:
            env.close()

    # Serve browser assets independently of the single simulation worker.
    handler = partial(ViewerHandler, directory=dist)
    with ThreadPoolExecutor(max_workers=1) as simulation:
        models = simulation.submit(load_models, args.policy_config).result()
        with ThreadingHTTPServer((args.host, args.port), handler) as server:
            server.widths = WIDTHS
            server.rollout = rollout
            server.models = models
            server.simulation = simulation
            server.policy_rollout = partial(run_model, obs_mode=args.obs_mode, control_mode=args.control_mode)
            print(f"Grasp Lab listening at http://{args.host}:{server.server_port}", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()
