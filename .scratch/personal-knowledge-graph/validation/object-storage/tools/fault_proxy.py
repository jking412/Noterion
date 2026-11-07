"""Issue #10 fault injection against the real local S3 reference service.

Run ``python tools/fault_proxy.py`` from the object-storage validation directory.
Configure the Rust SDK endpoint as http://127.0.0.1:19110 and use path-style
addressing. The upstream is fixed at http://127.0.0.1:19100. The original Host
header is forwarded unchanged so the upstream can verify the original SigV4
signature. Stop this process with Ctrl+C when the experiment is complete.

Only generated test keys containing these markers activate faults:
* issue-10-drop-put: forward PUT and consume its real response, then disconnect.
* issue-10-drop-complete: do the same for POST with an uploadId query parameter.
* issue-10-embedded-error: answer completion locally with HTTP 200 / InvalidPart;
  the actual completion request is deliberately NOT forwarded.

Requests must have Content-Length when they have a body; chunked request bodies
are rejected. Bodies are copied in bounded chunks. No URL, header, query, body,
credential, or exception text is logged. JSON logs contain only mode, method,
and upstream_status (null for locally synthesized responses).
"""

from __future__ import annotations

import http.client
import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit


LISTEN = ("127.0.0.1", 19110)
UPSTREAM = ("127.0.0.1", 19100)
CHUNK_SIZE = 64 * 1024
HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "proxy-connection",
}
EMBEDDED_ERROR = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b'<Error><Code>InvalidPart</Code>'
    b'<Message>Issue 10 injected completion error</Message>'
    b'<RequestId>issue-10-embedded-error</RequestId></Error>'
)


class FaultProxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *args: object) -> None:
        # BaseHTTPRequestHandler otherwise prints the full request target.
        pass

    def _record(self, mode: str, status: int | None) -> None:
        print(json.dumps({
            "mode": mode,
            "method": self.command,
            "upstream_status": status,
        }), flush=True)

    def _local_response(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        self.close_connection = True

    def _disconnect(self) -> None:
        self.close_connection = True
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.connection.close()

    def _copy_request(self, length: int, upstream: http.client.HTTPConnection | None) -> None:
        remaining = length
        while remaining:
            chunk = self.rfile.read(min(remaining, CHUNK_SIZE))
            if not chunk:
                raise ConnectionError("Incomplete request body")
            if upstream is not None:
                upstream.send(chunk)
            remaining -= len(chunk)

    def _proxy(self) -> None:
        self.connection.settimeout(120)
        upstream = None
        response_started = False
        status = None
        mode = "pass"
        try:
            if self.headers.get("Transfer-Encoding"):
                self._record("unsupported-request-transfer-encoding", None)
                self._local_response(501, b"Content-Length is required.\n", "text/plain")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0:
                    raise ValueError
            except ValueError:
                self._record("invalid-content-length", None)
                self._local_response(400, b"Invalid Content-Length.\n", "text/plain")
                return

            target = urlsplit(self.path)
            key_path = unquote(target.path)
            is_complete = (
                self.command == "POST"
                and "uploadId" in parse_qs(target.query, keep_blank_values=True)
            )
            if is_complete and "issue-10-embedded-error" in key_path:
                self._copy_request(length, None)
                self._record("embedded-error", None)
                self._local_response(200, EMBEDDED_ERROR, "application/xml")
                return
            if self.command == "PUT" and "issue-10-drop-put" in key_path:
                mode = "drop-put"
            elif is_complete and "issue-10-drop-complete" in key_path:
                mode = "drop-complete"

            # skip_host prevents http.client from replacing the signed Host.
            upstream = http.client.HTTPConnection(*UPSTREAM, timeout=120)
            upstream.putrequest(
                self.command, self.path, skip_host=True, skip_accept_encoding=True,
            )
            connection_headers = {
                value.strip().lower()
                for value in self.headers.get("Connection", "").split(",")
            }
            for name, value in self.headers.items():
                if name.lower() not in HOP_HEADERS | connection_headers:
                    upstream.putheader(name, value)
            upstream.putheader("Connection", "close")
            upstream.endheaders()
            self._copy_request(length, upstream)
            response = upstream.getresponse()
            status = response.status

            if mode in {"drop-put", "drop-complete"}:
                # Consume the upstream response before losing the client's result.
                while response.read(CHUNK_SIZE):
                    pass
                self._record(mode, status)
                self._disconnect()
                return

            self.send_response_only(response.status, response.reason)
            response_started = True
            response_connection_headers = {
                value.strip().lower()
                for value in (response.getheader("Connection") or "").split(",")
            }
            for name, value in response.getheaders():
                if name.lower() not in HOP_HEADERS | response_connection_headers:
                    self.send_header(name, value)
            # Close-delimiting also handles dechunked responses lacking a length.
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            if self.command != "HEAD":
                while chunk := response.read(CHUNK_SIZE):
                    self.wfile.write(chunk)
            self._record(mode, status)
        except (OSError, http.client.HTTPException, ValueError):
            self._record("transport-error", status)
            if not response_started:
                try:
                    self._local_response(502, b"Upstream transport failed.\n", "text/plain")
                except OSError:
                    self._disconnect()
            else:
                self._disconnect()
        finally:
            if upstream is not None:
                upstream.close()

    do_GET = _proxy
    do_HEAD = _proxy
    do_PUT = _proxy
    do_POST = _proxy
    do_DELETE = _proxy
    do_OPTIONS = _proxy


class ProxyServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def handle_error(self, _request: object, _client_address: object) -> None:
        # Avoid traceback/request details on unexpected worker errors.
        print(json.dumps({
            "mode": "worker-error", "method": None, "upstream_status": None,
        }), flush=True)


if __name__ == "__main__":
    try:
        with ProxyServer(LISTEN, FaultProxy) as server:
            server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
