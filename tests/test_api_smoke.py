from __future__ import annotations

import importlib.util
import unittest


HAS_DEPS = all(importlib.util.find_spec(name) for name in ("fastapi", "sqlalchemy", "httpx"))


@unittest.skipUnless(HAS_DEPS, "web collector dependencies are not installed")
class ApiSmokeTest(unittest.TestCase):
    def test_app_imports(self) -> None:
        from backend.app import app

        self.assertEqual(app.title, "Laya Real-pilot Clinical Collector")


if __name__ == "__main__":
    unittest.main()
