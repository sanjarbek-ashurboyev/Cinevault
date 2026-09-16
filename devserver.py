#!/usr/bin/env python
"""Serve frontend/ for local development, with browser caching turned off.

`python -m http.server` sends Last-Modified and no Cache-Control whatsoever.
A response with no explicit freshness lifetime leaves the browser free to
apply a heuristic instead (RFC 9111 §4.2.2) — Chrome commonly treats such a
file as fresh for a fraction of its age and serves it from disk cache without
revalidating. The effect during development is that you edit a .css or .js
file, reload, and see the previous version, with no request in the network
log to explain it. `no-store` takes the guesswork away.

This is a development convenience only. Nothing here is meant to face the
internet: it is the stdlib static server with one header added.
"""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    # HTTP/1.0 closes the connection after every response, which makes a page
    # of twenty assets twenty handshakes.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("port", nargs="?", type=int, default=5500)
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--directory", default="frontend")
    args = ap.parse_args()

    handler = partial(NoCacheHandler, directory=args.directory)
    with ThreadingHTTPServer((args.bind, args.port), handler) as httpd:
        print(f"frontend → http://{args.bind}:{args.port}  (caching disabled)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
