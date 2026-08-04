from sqlalchemy import Column, Integer, String

from app.database import Base


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String, nullable=False)
    rule_id = Column(String, nullable=False)
    severity = Column(Integer, nullable=False)
    src_ip = Column(String, nullable=False)
    hostname = Column(String, nullable=False)
    timestamp = Column(String, nullable=False)
    status = Column(String, nullable=False, default="new")
