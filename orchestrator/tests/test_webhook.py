import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
MOCK_ALERT = json.loads(
    (Path(__file__).parent.parent / "mocks" / "wazuh_ssh_bruteforce.json").read_text()
)


def test_webhook_normalizes_and_persists_ssh_bruteforce_alert():
    resp = client.post("/api/v1/webhook/wazuh", json=MOCK_ALERT)

    assert resp.status_code == 201
    body = resp.json()
    assert body["source"] == "wazuh"
    assert body["ruleId"] == "5712"
    assert body["severity"] == 10
    assert body["srcIp"] == "203.0.113.55"
    assert body["hostname"] == "ip-10-0-1-23"
    assert body["status"] == "new"


def test_webhook_rejects_alert_missing_required_fields():
    resp = client.post("/api/v1/webhook/wazuh", json={"rule": {"id": "1"}})

    assert resp.status_code == 422


def test_list_incidents_returns_persisted_alert():
    client.post("/api/v1/webhook/wazuh", json=MOCK_ALERT)

    resp = client.get("/api/v1/incidents")

    assert resp.status_code == 200
    assert any(i["srcIp"] == "203.0.113.55" for i in resp.json())
