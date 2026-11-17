"""Package the Vite build as a single HTML file that opens offline."""
import argparse
import base64
import html
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def encode(path, media_type):
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{media_type};base64,{payload}"


def safe_script(source):
    return re.sub(r"</script", lambda match: "<\\/" + match.group()[2:], source, flags=re.I)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--video", type=Path, help="optional MP4 to include when output is a ZIP")
    args = parser.parse_args()
    archive_output = args.output.suffix.lower() == ".zip"
    if args.video and (not archive_output or not args.video.is_file()):
        parser.error("--video requires an existing file and a ZIP output")
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
    if archive_output:
        demo = dist.parent / "demo"
        with ZipFile(args.output, mode="w", compression=ZIP_DEFLATED) as archive:
            archive.writestr("Grasp-Lab/grasp-lab.html", page)
            archive.write(demo / "open_demo.py", "Grasp-Lab/open_demo.py")
            notes = (demo / "OPEN-DEMO.txt").read_text(encoding="utf-8")
            if args.video:
                archive.write(args.video, "Grasp-Lab/grasp-visualization.mp4")
            else:
                notes = notes.split("\nIf WebGL 2 is unavailable:")[0]
            archive.writestr("Grasp-Lab/OPEN-DEMO.txt", notes)
    else:
        args.output.write_text(page, encoding="utf-8")


if __name__ == "__main__":
    main()
