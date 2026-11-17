"""Package the Vite build as a single HTML file that opens offline."""
import argparse
import base64
import html
import json
import re
from pathlib import Path


def encode(path, media_type):
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{media_type};base64,{payload}"


def safe_script(source):
    return re.sub(r"</script", lambda match: "<\\/" + match.group()[2:], source, flags=re.I)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    dist = Path(__file__).resolve().parent / "dist"
    page = (dist / "index.html").read_text()
    bundle = re.search(r'<script type="module"[^>]+src="([^"]+)"></script>', page)
    styles = re.search(r'<link rel="stylesheet"[^>]+href="([^"]+)">', page)
    if not bundle or not styles:
        parser.error("could not find built JavaScript and CSS; run npm run build")

    data = {path.name: json.loads(path.read_text()) for path in (dist / "data").glob("*.json")}
    assets = {
        "robot/" + path.name: encode(path, "model/gltf-binary")
        for path in (dist / "robot").glob("*.glb")
    }
    bootstrap = (
        "window.GRASP_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
        "window.GRASP_ASSETS=" + json.dumps(assets, separators=(",", ":")) + ";"
    )
    code = (dist / bundle[1]).read_text()
    css = (dist / styles[1]).read_text()
    page = page.replace(bundle[0], "<script>" + safe_script(bootstrap) + "</script>\n"
                        '<script type="module">' + safe_script(code) + "</script>")
    page = page.replace(styles[0], "<style>" + css + "</style>")
    page = page.replace("./data/trials.csv", encode(dist / "data/trials.csv", "text/csv"))
    attribution = (dist / "robot/NOTICE").read_text() + "\n" + (dist / "robot/LICENSE").read_text()
    page = page.replace("</html>", "<!--\n" + html.escape(attribution).replace("--", "—") + "\n-->\n</html>")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(page, encoding="utf-8")


if __name__ == "__main__":
    main()
