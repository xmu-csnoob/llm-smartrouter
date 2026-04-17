import unittest
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException

from llm_router.proxy import StreamProxy, UpstreamRequestError
from llm_router.upstream_errors import UpstreamErrorInfo


class ProxyErrorHandlingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.proxy = StreamProxy(
            config=Mock(),
            router=Mock(),
            tracker=Mock(),
            req_logger=Mock(),
        )

    async def asyncTearDown(self):
        await self.proxy.client.aclose()

    async def test_bad_request_upstream_does_not_fallback_and_preserves_status(self):
        error_info = UpstreamErrorInfo(
            category="bad_request_upstream",
            message="invalid request body",
        )
        self.proxy._anthropic_normal = AsyncMock(
            side_effect=UpstreamRequestError(400, "invalid request body", error_info)
        )
        self.proxy._try_fallback_anthropic = AsyncMock(return_value={"unexpected": True})

        with self.assertRaises(HTTPException) as exc:
            await self.proxy._forward_to_anthropic(
                body={},
                provider_cfg={"base_url": "https://example.com", "api_key": "test", "timeout": 1},
                model_id="model-a",
                tier="tier1",
                is_stream=False,
                log_entry={},
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.proxy._try_fallback_anthropic.assert_not_called()
        self.proxy.req_logger.log.assert_called_once()

    async def test_retryable_http_failure_logs_only_after_fallback_result(self):
        error_info = UpstreamErrorInfo(
            category="server_error",
            message="upstream overloaded",
            retry_after_seconds=30,
        )
        self.proxy._anthropic_normal = AsyncMock(
            side_effect=UpstreamRequestError(503, "upstream overloaded", error_info)
        )
        self.proxy._try_fallback_anthropic = AsyncMock(return_value={"ok": True})

        result = await self.proxy._forward_to_anthropic(
            body={},
            provider_cfg={"base_url": "https://example.com", "api_key": "test", "timeout": 1},
            model_id="model-a",
            tier="tier1",
            is_stream=False,
            log_entry={},
        )

        self.assertEqual(result, {"ok": True})
        self.proxy._try_fallback_anthropic.assert_awaited_once()
        self.proxy.req_logger.log.assert_not_called()


if __name__ == "__main__":
    unittest.main()
