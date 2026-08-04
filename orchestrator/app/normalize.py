def normalize_wazuh_alert(alert: dict) -> dict:
    """Alerta cruda de Wazuh -> modelo Incident canónico (PLAN.md sección 7)."""
    try:
        return {
            "source": "wazuh",
            "rule_id": str(alert["rule"]["id"]),
            "severity": alert["rule"]["level"],
            "src_ip": alert["data"]["srcip"],
            "hostname": alert["agent"]["name"],
            "timestamp": alert["timestamp"],
            "status": "new",
        }
    except KeyError as e:
        raise ValueError(f"Campo faltante en la alerta de Wazuh: {e}") from e
