import asyncio
import unittest

from llm_router.request_logger import RequestLogger


class RequestLoggerTests(unittest.TestCase):
    def test_log_enqueues_snapshot_not_mutable_reference(self):
        logger = RequestLogger({"enabled": True, "dir": "./logs"})
        logger._queue = asyncio.Queue()

        entry = {"status": 502, "fallback_chain": []}
        logger.log(entry)
        entry["status"] = 200
        entry["fallback_chain"].append({"model": "changed"})

        queued = logger._queue.get_nowait()
        self.assertEqual(queued["status"], 502)
        self.assertEqual(queued["fallback_chain"], [])


if __name__ == "__main__":
    unittest.main()
