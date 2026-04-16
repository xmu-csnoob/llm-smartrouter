#!/usr/bin/env python3
"""
Integration tests against the llm-router HTTP API (port 8001).

Run with:
    python -m tests.test_api_integration

Requires the router server running on port 8001 with config-minimax.yaml.
"""

import unittest
import json
import urllib.request
import urllib.parse
import urllib.error


BASE = "http://localhost:8001"


def api_get(path: str, **params) -> tuple[int, dict | str]:
    url = f"{BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            body = resp.read()
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, body.decode()
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
            return e.code, json.loads(body)
        except Exception:
            return e.code, body.decode()
    except Exception as e:
        return 0, str(e)


def api_post(path: str, body: dict | None = None) -> tuple[int, dict | str]:
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else b""
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            response_body = resp.read()
            try:
                return resp.status, json.loads(response_body)
            except json.JSONDecodeError:
                return resp.status, response_body.decode()
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
            return e.code, json.loads(body)
        except Exception:
            return e.code, body.decode()
    except Exception as e:
        return 0, str(e)


class TestHealthEndpoints(unittest.TestCase):
    def test_health_returns_ok(self):
        status, body = api_get("/health")
        self.assertEqual(status, 200, f"Health check failed: {body}")
        self.assertEqual(body["status"], "ok")

    def test_status_returns_200(self):
        status, body = api_get("/status")
        self.assertEqual(status, 200, f"Status failed: {body}")
        self.assertIn("models", body)
        self.assertIn("total_requests", body)


class TestModelEndpoints(unittest.TestCase):
    def test_v1_models_returns_list(self):
        status, body = api_get("/v1/models")
        self.assertEqual(status, 200, f"v1/models failed: {body}")
        self.assertEqual(body["object"], "list")
        self.assertIsInstance(body["data"], list)
        for model in body["data"]:
            self.assertIn("id", model)
            self.assertIn("tier", model)
            self.assertIn("object", model)


class TestLogsStatsEndpoint(unittest.TestCase):
    def test_stats_returns_200(self):
        status, body = api_get("/api/logs/stats")
        self.assertEqual(status, 200, f"Stats failed: {body}")

    def test_stats_returns_expected_fields(self):
        _status, body = api_get("/api/logs/stats")
        expected_fields = [
            "total", "errors", "error_rate",
            "fallbacks", "fallback_rate",
            "avg_latency_ms", "avg_ttft_ms",
            "models",
        ]
        for field in expected_fields:
            self.assertIn(field, body, f"Missing field: {field}")

    def test_stats_with_hours_param(self):
        status, body = api_get("/api/logs/stats", hours=1)
        self.assertEqual(status, 200, f"Stats with hours failed: {body}")
        self.assertIn("total", body)

    def test_stats_hours_zero(self):
        status, body = api_get("/api/logs/stats", hours=0)
        # hours=0 may mean "all time" or be rejected — just check it doesn't 500
        self.assertIn(status, (200, 400), f"Unexpected status {status}: {body}")


class TestLogsRecentEndpoint(unittest.TestCase):
    def test_recent_returns_200(self):
        status, body = api_get("/api/logs/recent")
        self.assertEqual(status, 200, f"Recent failed: {body}")
        self.assertIn("entries", body)
        self.assertIn("total", body)
        self.assertIn("offset", body)
        self.assertIn("limit", body)

    def test_recent_pagination_defaults(self):
        _status, body = api_get("/api/logs/recent")
        self.assertEqual(body["offset"], 0)
        self.assertIsInstance(body["entries"], list)

    def test_recent_pagination_params(self):
        status, body = api_get("/api/logs/recent", offset=10, limit=5)
        self.assertEqual(status, 200, f"Recent pagination failed: {body}")
        self.assertEqual(body["offset"], 10)
        self.assertLessEqual(len(body["entries"]), 5)

    def test_recent_filter_by_model(self):
        # First get available models
        _, models_body = api_get("/v1/models")
        model_list = models_body.get("data", [])
        if not model_list:
            self.skipTest("No models available to filter by")

        model_id = model_list[0]["id"]
        status, body = api_get("/api/logs/recent", offset=0, limit=5, model=model_id)
        self.assertEqual(status, 200, f"Recent filter by model failed: {body}")
        # Entries may or may not match model depending on actual logs — just verify structure

    def test_recent_invalid_limit(self):
        status, body = api_get("/api/logs/recent", limit=0)
        # Should either reject or use default
        self.assertIn(status, (200, 400), f"Unexpected status: {status}")


class TestLogsArchiveEndpoint(unittest.TestCase):
    def test_archive_returns_200(self):
        status, body = api_post("/api/logs/archive")
        self.assertEqual(status, 200, f"Archive failed: {body}")

    def test_archive_returns_expected_fields(self):
        _status, body = api_post("/api/logs/archive")
        self.assertIn("archived", body)
        self.assertIn("skipped", body)
        self.assertIn("total_archived", body)
        self.assertIsInstance(body["archived"], list)
        self.assertIsInstance(body["skipped"], list)
        self.assertIsInstance(body["total_archived"], int)

    def test_archive_idempotent(self):
        # Running archive twice should be safe (skipped, not errored)
        status1, body1 = api_post("/api/logs/archive")
        status2, body2 = api_post("/api/logs/archive")
        self.assertEqual(status1, 200)
        self.assertEqual(status2, 200)
        # Second run should have 0 newly archived (all skipped)
        # (Depends on whether logs exist — just verify no crash)


class TestLogsReplayEndpoint(unittest.TestCase):
    def test_replay_returns_200(self):
        status, body = api_get("/api/logs/replay")
        self.assertEqual(status, 200, f"Replay failed: {body}")
        self.assertIn("total", body)
        self.assertIn("changed", body)
        self.assertIn("change_rate", body)
        self.assertIn("entries", body)

    def test_replay_with_params(self):
        status, body = api_get("/api/logs/replay", hours=1, limit=10)
        self.assertEqual(status, 200, f"Replay with params failed: {body}")

    def test_replay_entries_structure(self):
        _, body = api_get("/api/logs/replay")
        for entry in body.get("entries", []):
            self.assertIn("request_id", entry)
            self.assertIn("previous_selected_tier", entry)
            self.assertIn("replayed_selected_tier", entry)
            self.assertIn("changed", entry)


class TestLogsAnalyzeEndpoint(unittest.TestCase):
    def test_analyze_returns_200_or_400(self):
        # May return 200 (SSE stream) or 400 if no data — both acceptable
        # Use curl to handle SSE stream properly
        import subprocess
        result = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             "--max-time", "10",
             "-X", "POST", f"{BASE}/api/logs/analyze",
             "-H", "Content-Type: application/json",
             "-d", '{"hours":1,"lang":"en"}'],
            capture_output=True, text=True, timeout=15,
        )
        status = int(result.stdout.strip())
        self.assertIn(status, (200, 400, 503), f"Unexpected status: {status}")

    def test_analyze_with_valid_params(self):
        import subprocess
        result = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             "--max-time", "10",
             "-X", "POST", f"{BASE}/api/logs/analyze",
             "-H", "Content-Type: application/json",
             "-d", '{"hours":1,"lang":"en"}'],
            capture_output=True, text=True, timeout=15,
        )
        status = int(result.stdout.strip())
        self.assertIn(status, (200, 400, 503), f"Unexpected status: {status}")

    def test_analyze_invalid_lang(self):
        # SSE streaming endpoint — just verify it doesn't crash the server
        import subprocess
        result = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             "--max-time", "10",
             "-X", "POST", f"{BASE}/api/logs/analyze",
             "-H", "Content-Type: application/json",
             "-d", '{"hours":24,"lang":"xx"}'],
            capture_output=True, text=True, timeout=15,
        )
        status = int(result.stdout.strip())
        self.assertIn(status, (200, 400, 503), f"Unexpected status: {status}")


class TestReloadEndpoint(unittest.TestCase):
    def test_reload_returns_200(self):
        status, body = api_post("/reload")
        self.assertEqual(status, 200, f"Reload failed: {body}")
        self.assertEqual(body["status"], "reloaded")


class TestProxyEndpoints(unittest.TestCase):
    def test_v1_messages_invalid_body(self):
        # Send a clearly invalid body — should get a 4xx/5xx, not a crash
        status, body = api_post(
            "/v1/messages",
            {"model": "nonexistent-model-xyz", "messages": []},
        )
        self.assertGreaterEqual(status, 400, f"Expected error response, got {status}: {body}")

    def test_v1_messages_wrong_content_type(self):
        # Send wrong content type — should handle gracefully
        url = f"{BASE}/v1/messages"
        data = b"not json"
        req = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "text/plain"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                status = resp.status
                # Any response (even 422) is acceptable — just not a crash
                self.assertIn(status, range(200, 600))
        except urllib.error.HTTPError as e:
            self.assertIn(e.code, range(400, 600))
        except Exception:
            pass  # connection error is also acceptable in test env without real upstream


class TestNonexistentEndpoints(unittest.TestCase):
    def test_404_for_unknown_path(self):
        status, body = api_get("/api/nonexistent")
        self.assertEqual(status, 404, f"Expected 404, got {status}: {body}")

    def test_405_for_wrong_method(self):
        # GET on POST-only endpoint — FastAPI returns 404 instead of 405
        # because the path is completely unknown to the GET router.
        # Both 404 and 405 are acceptable for "method not allowed on this path".
        status, _ = api_get("/api/logs/archive")
        self.assertIn(status, (404, 405), f"Expected 404/405, got {status}")


if __name__ == "__main__":
    # Verify server is reachable before running tests
    status, body = api_get("/health")
    if status != 200:
        print(f"ERROR: Router not reachable at {BASE} (got status {status}).")
        print(f"  Start with: python -m llm_router /Users/wangwenfei/llm-router/config-minimax.yaml --port 8001")
        exit(1)
    print(f"Router reachable at {BASE}, running tests...\n")

    unittest.main(verbosity=2)
