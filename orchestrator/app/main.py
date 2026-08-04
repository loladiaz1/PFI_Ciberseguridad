from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import Incident
from app.normalize import normalize_wazuh_alert

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Micro-SOAR Orchestrator")


def _serialize(incident: Incident) -> dict:
    return {
        "id": incident.id,
        "source": incident.source,
        "ruleId": incident.rule_id,
        "severity": incident.severity,
        "srcIp": incident.src_ip,
        "hostname": incident.hostname,
        "timestamp": incident.timestamp,
        "status": incident.status,
    }


@app.post("/api/v1/webhook/wazuh", status_code=201)
def receive_wazuh_alert(alert: dict, db: Session = Depends(get_db)):
    try:
        fields = normalize_wazuh_alert(alert)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    incident = Incident(**fields)
    db.add(incident)
    db.commit()
    db.refresh(incident)

    return _serialize(incident)


@app.get("/api/v1/incidents")
def list_incidents(db: Session = Depends(get_db)):
    incidents = db.query(Incident).order_by(Incident.id.desc()).all()
    return [_serialize(i) for i in incidents]
