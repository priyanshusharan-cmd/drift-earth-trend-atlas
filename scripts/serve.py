"""Local server for web/ that disables caching, so edits show on reload."""

import functools
import http.server
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    handler = functools.partial(Handler, directory=str(WEB))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Drift running at http://localhost:{port}")
        httpd.serve_forever()
