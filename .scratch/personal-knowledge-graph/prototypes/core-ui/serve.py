"""Issue #1 throwaway static prototype. No dependencies or personal data."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=8103)
args = parser.parse_args()
root = Path(__file__).resolve().parent
handler = partial(SimpleHTTPRequestHandler, directory=str(root))
server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
print(f'Issue #1 Noterion prototype: http://127.0.0.1:{args.port}/?variant=A', flush=True)
print('Fixed demo data only. Ctrl+C stops this server.', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
