"""Open the extracted Grasp Lab demo through a local web server."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import webbrowser


def main():
    directory = Path(__file__).resolve().parent
    if not (directory / "grasp-lab.html").is_file():
        raise SystemExit("Extract the entire Grasp Lab ZIP before running this script.")

    handler = partial(SimpleHTTPRequestHandler, directory=directory)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/grasp-lab.html?present=1"
        print(f"Open this URL in your browser:\n{url}\nPress Ctrl+C to stop.", flush=True)
        Thread(target=webbrowser.open, args=(url,), daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
