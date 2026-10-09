import unittest
import asyncio
from fastapi.testclient import TestClient
from main import app, manager

class TestLumaBackend(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_check(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("service"), "luma-monitor-backend")

    def test_session_lifecycle(self):
        # 1. Create session
        create_res = self.client.post("/api/sessions")
        self.assertEqual(create_res.status_code, 201)
        data = create_res.json()
        session_id = data.get("sessionId")
        token = data.get("token")
        self.assertTrue(bool(session_id))
        self.assertTrue(bool(token))

        # 2. Query session info
        get_res = self.client.get(f"/api/sessions/{session_id}")
        self.assertEqual(get_res.status_code, 200)
        session_data = get_res.json()
        self.assertEqual(session_data.get("sessionId"), session_id)

        # 3. Nonexistent session
        bad_res = self.client.get("/api/sessions/INVALID")
        self.assertEqual(bad_res.status_code, 404)

        # 4. End session
        end_res = self.client.post(f"/api/sessions/{session_id}/end")
        self.assertEqual(end_res.status_code, 200)

        # 5. Verify deleted
        after_res = self.client.get(f"/api/sessions/{session_id}")
        self.assertEqual(after_res.status_code, 404)

if __name__ == "__main__":
    unittest.main()
