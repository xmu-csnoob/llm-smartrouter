import unittest

import httpx

from llm_router.upstream_errors import classify_upstream_exception, classify_upstream_response


class UpstreamErrorClassificationTests(unittest.TestCase):
    def test_usage_limit_message_maps_to_quota_exhausted(self):
        info = classify_upstream_response(
            429,
            {},
            '{"error":{"type":"rate_limit_error","message":"You\'ve reached your usage limit for this period."},"type":"error"}',
        )

        self.assertEqual(info.category, "quota_exhausted")
        self.assertEqual(info.provider_type, "rate_limit_error")
        self.assertTrue(info.is_durable)

    def test_retry_after_header_maps_to_transient_rate_limit(self):
        info = classify_upstream_response(
            429,
            {"Retry-After": "30"},
            '{"error":{"type":"rate_limit_error","message":"Too many requests"}}',
        )

        self.assertEqual(info.category, "transient_rate_limit")
        self.assertEqual(info.retry_after_seconds, 30.0)
        self.assertFalse(info.is_durable)

    def test_insufficient_quota_code_maps_to_quota_exhausted(self):
        info = classify_upstream_response(
            429,
            {},
            '{"error":{"code":"insufficient_quota","message":"quota exhausted"}}',
        )

        self.assertEqual(info.category, "quota_exhausted")
        self.assertEqual(info.provider_code, "insufficient_quota")

    def test_reset_header_is_parsed_to_epoch(self):
        info = classify_upstream_response(
            429,
            {"X-RateLimit-Reset": "2000000000"},
            '{"error":{"type":"rate_limit_error","message":"Too many requests"}}',
        )

        self.assertEqual(info.category, "transient_rate_limit")
        self.assertEqual(info.reset_at_epoch, 2000000000.0)

    def test_403_quota_message_maps_to_quota_exhausted(self):
        info = classify_upstream_response(
            403,
            {"X-RateLimit-Reset": "2000000000"},
            '{"error":{"message":"quota exceeded for current billing period"}}',
        )

        self.assertEqual(info.category, "quota_exhausted")
        self.assertEqual(info.reset_at_epoch, 2000000000.0)

    def test_403_with_retry_after_maps_to_transient_rate_limit(self):
        info = classify_upstream_response(
            403,
            {"Retry-After": "120"},
            '{"error":{"message":"temporarily suspended, retry later"}}',
        )

        self.assertEqual(info.category, "transient_rate_limit")
        self.assertEqual(info.retry_after_seconds, 120.0)

    def test_503_with_retry_after_preserves_retry_window(self):
        info = classify_upstream_response(
            503,
            {"Retry-After": "45"},
            '{"error":{"message":"upstream overloaded"}}',
        )

        self.assertEqual(info.category, "server_error")
        self.assertEqual(info.retry_after_seconds, 45.0)

    def test_timeout_exception_maps_to_timeout(self):
        info = classify_upstream_exception(httpx.ReadTimeout("read timed out"))
        self.assertEqual(info.category, "timeout")

    def test_transport_exception_maps_to_connection_error(self):
        info = classify_upstream_exception(httpx.ConnectError("connection reset"))
        self.assertEqual(info.category, "connection_error")


if __name__ == "__main__":
    unittest.main()
