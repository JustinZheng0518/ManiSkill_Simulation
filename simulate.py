"""Serve the built viewer and run fresh ManiSkill grasp rollouts on request."""
import argparse
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
from pathlib import Path
import traceback
from urllib.parse import parse_qs, urlsplit


class ViewerHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/api/health":
            self.send_json({"simulator": "ManiSkill"})
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
            rollout = self.server.rollout(width, seed)
        except Exception:
            self.log_error("ManiSkill rollout failed for width %s and seed %s", width, seed)
            traceback.print_exc()
            self.send_json({"error": "The ManiSkill rollout failed. See the server output."}, 500)
        else:
            self.send_json(rollout)

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
    args = parser.parse_args()
    dist = Path(__file__).resolve().parent / "dist"
    if not (dist / "index.html").is_file():
        parser.error("Run npm ci and npm run build first.")

    from benchmark import WIDTHS, make_env, run_episode, torch

    torch.set_num_threads(1)

    def rollout(width, seed):
        env = make_env(width)
        try:
            return {"width_mm": width, **run_episode(env, seed)}
        finally:
            env.close()

    # Keep all SAPIEN work on the same thread as the server.
    handler = partial(ViewerHandler, directory=dist)
    with HTTPServer((args.host, args.port), handler) as server:
        server.widths = WIDTHS
        server.rollout = rollout
        print(f"Grasp Lab listening at http://{args.host}:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
