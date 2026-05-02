from sqlalchemy import create_engine, Column, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func
import uuid
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./grc_copilot.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    system_description = Column(Text)
    system_boundary = Column(Text)
    data_classification = Column(String)          # Low / Moderate / High
    baseline = Column(String, nullable=False)     # Low / Moderate / High
    oscal_ssp_url = Column(String)                # Optional FedRAMP OSCAL SSP source URL
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    controls = relationship("Control", back_populates="project", cascade="all, delete")
    gaps = relationship("Gap", back_populates="project", cascade="all, delete")
    poam_items = relationship("PoamItem", back_populates="project", cascade="all, delete")
    odp_values = relationship("ProjectODP", back_populates="project", cascade="all, delete")


class Control(Base):
    """
    One row per control in the project's selected baseline.
    implementation_statement is Claude's draft (editable by analyst).
    """
    __tablename__ = "controls"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    control_id = Column(String, nullable=False)       # e.g. "ac-2"
    family = Column(String, nullable=False)           # e.g. "AC"
    title = Column(String, nullable=False)            # e.g. "Account Management"
    implementation_statement = Column(Text)           # Claude's draft
    status = Column(String, default="draft")          # draft | reviewed | approved

    project = relationship("Project", back_populates="controls")


class Gap(Base):
    """
    Result of gap assessment — one row per control evaluated.
    """
    __tablename__ = "gaps"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    control_id = Column(String, nullable=False)
    family = Column(String, nullable=False)
    title = Column(String, nullable=False)
    gap_status = Column(String)         # Implemented | Partially Implemented | Not Implemented
    rationale = Column(Text)            # Claude's one-sentence explanation
    objective_findings = Column(Text)   # JSON: [{objective, met, note}, ...]
    cve_refs = Column(Text)             # JSON: ["CVE-2024-XXXX", ...]

    project = relationship("Project", back_populates="gaps")


class PoamItem(Base):
    """
    One POA&M entry per gap finding.
    """
    __tablename__ = "poam_items"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    control_id = Column(String, nullable=False)
    weakness_description = Column(Text)     # Claude's draft
    risk_level = Column(String)             # High | Medium | Low
    remediation_steps = Column(Text)        # Claude's draft (newline-separated)
    milestones = Column(Text)               # Claude's suggested timeline
    cve_refs = Column(Text)                 # JSON: ["CVE-2024-XXXX", ...]
    status = Column(String, default="open") # open | in_progress | closed

    project = relationship("Project", back_populates="poam_items")


class ProjectODP(Base):
    """
    One row per Organization-Defined Parameter per project.
    Populated from the 800-53A catalog; values filled in by analyst (or parsed from OSCAL SSP).
    """
    __tablename__ = "project_odps"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    control_id = Column(String, nullable=False)          # e.g. "ac-2"
    param_id = Column(String, nullable=False)            # e.g. "ac-02_odp.01"
    label = Column(String)                               # e.g. "time period"
    required_definition = Column(Text)                   # guideline prose from 800-53A
    value = Column(Text)                                 # analyst-supplied value
    is_choice = Column(Boolean, default=False)           # True if param has select choices
    choices = Column(Text)                               # JSON array of choices if is_choice

    project = relationship("Project", back_populates="odp_values")


def init_db():
    Base.metadata.create_all(bind=engine)
