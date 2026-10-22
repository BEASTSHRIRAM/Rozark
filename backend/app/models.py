from __future__ import annotations
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field, model_validator

class Difficulty(str, Enum):
    easy="easy"; medium="medium"; hard="hard"
class ChallengeType(str, Enum):
    frontend="frontend"; backend="backend"; fullstack="fullstack"; mobile="mobile"; qa="qa"
class ProjectSource(str, Enum):
    upload_zip="upload_zip"; clone_github="clone_github"; sample="sample"
class ScoringMode(str, Enum):
    automated="automated"; manual="manual"; custom="custom"
class ScoringFormat(str, Enum):
    junit="junit"; xunit="xunit"; tap="tap"; custom_fs_score="custom_fs_score"

class Actor(str, Enum):
    candidate="candidate"; agent="agent"; system="system"
class PromptPhase(str, Enum):
    planning="planning"; building="building"; debugging="debugging"

class EventType(str, Enum):
    # --- original MVP types (kept for backward compatibility) ---
    prompt="prompt"; tool_call="tool_call"; file_view="file_view"; file_edit="file_edit"
    terminal="terminal"; test_run="test_run"; agent_response="agent_response"
    # --- sandbox / event-log-schema v1 additions (docs/EVENT_LOG_SCHEMA.md) ---
    session_started="session_started"; brief_viewed="brief_viewed"
    terminal_cmd="terminal_cmd"; terminal_output="terminal_output"
    paste_event="paste_event"; clipboard_event="clipboard_event"; tab_switch="tab_switch"
    token_usage="token_usage"; git_snapshot="git_snapshot"
    budget_exceeded="budget_exceeded"; session_submitted="session_submitted"; session_expired="session_expired"

DIFFICULTY_DEFAULTS={Difficulty.easy:(50,15), Difficulty.medium:(75,30), Difficulty.hard:(100,60)}

class Environment(BaseModel):
    stack: str="python-fastapi"
    runtime: str="ubuntu-24.04"
class ProjectSetup(BaseModel):
    source: ProjectSource=ProjectSource.sample
    github_url: Optional[str]=None
    zip_filename: Optional[str]=None
class IDESetup(BaseModel):
    install_command: str=""
    run_command: str=""
    test_command: str="pytest -q"
    default_open_files: list[str]=Field(default_factory=lambda:["README.md"])
    read_only_files: list[str]=Field(default_factory=list)
    hidden_files: list[str]=Field(default_factory=list)
class ScoringSettings(BaseModel):
    mode: ScoringMode=ScoringMode.automated
    format: ScoringFormat=ScoringFormat.junit
    scoring_command: Optional[str]=None
    scoring_output_files: list[str]=Field(default_factory=list)
class AgentConfig(BaseModel):
    allowed_agents: list[str]=Field(default_factory=lambda:["claude_code","codex"])
    model: Optional[str]=None
    token_budget: int=Field(default=100000, ge=0)
    time_limit_minutes: Optional[int]=None
    internet_enabled: bool=False
class RubricWeights(BaseModel):
    functional: float=Field(default=0.4, ge=0.0, le=1.0)
    ai_collaboration: float=Field(default=0.6, ge=0.0, le=1.0)
    @model_validator(mode="after")
    def _weights_sum_to_one(self):
        if abs(self.functional + self.ai_collaboration - 1.0) > 1e-6:
            raise ValueError("rubric weights must sum to 1.0 (total score is a weighted mean on a 0-100 scale)")
        return self

class ChallengeCreate(BaseModel):
    title: str
    type: ChallengeType=ChallengeType.backend
    difficulty: Difficulty=Difficulty.medium
    score: Optional[int]=None
    recommended_time_minutes: Optional[int]=None
    tags: list[str]=Field(default_factory=list)
    problem_description: str=""
    software_instructions: str=""
    interviewer_guidelines: str=""
    environment: Environment=Field(default_factory=Environment)
    project_setup: ProjectSetup=Field(default_factory=ProjectSetup)
    ide_setup: IDESetup=Field(default_factory=IDESetup)
    scoring: ScoringSettings=Field(default_factory=ScoringSettings)
    agent_config: AgentConfig=Field(default_factory=AgentConfig)
    rubric_weights: RubricWeights=Field(default_factory=RubricWeights)
    def apply_defaults(self):
        d_score,d_time=DIFFICULTY_DEFAULTS[self.difficulty]
        if self.score is None: self.score=d_score
        if self.recommended_time_minutes is None: self.recommended_time_minutes=d_time
        if self.agent_config.time_limit_minutes is None:
            self.agent_config.time_limit_minutes=self.recommended_time_minutes
        return self

class Challenge(ChallengeCreate):
    id: str

class AttemptCreate(BaseModel):
    challenge_id: str
    candidate_name: str
    candidate_email: str=""
class SessionEventCreate(BaseModel):
    type: EventType
    actor: Actor=Actor.candidate
    payload: dict[str,Any]=Field(default_factory=dict)
class SessionEvent(SessionEventCreate):
    id: str
    attempt_id: str
    session_id: str=""
    sequence: int
    seq: int=0
    ts: str=""
class Attempt(BaseModel):
    id: str
    challenge_id: str
    candidate_name: str
    candidate_email: str=""
    status: str="in_progress"
    session_id: str=""
    # --- token budget tracking (docs/EVENT_LOG_SCHEMA.md: token_usage) ---
    token_budget: int=100000
    tokens_used: int=0
    tokens_by_phase: dict[str,int]=Field(default_factory=dict)
    budget_exceeded: bool=False
    budget_hard_stop: bool=False
    events: list[SessionEvent]=Field(default_factory=list)
    # --- session lifecycle (B3) ---
    started_at: str=""
    last_heartbeat_at: str=""
    time_limit_minutes: int=0
    expires_at: str=""
class SubmitRequest(BaseModel):
    junit_xml: Optional[str]=None
    tap_output: Optional[str]=None
    scorer_output: Optional[str]=None
    manual_functional_score: Optional[float]=None
class DimensionScore(BaseModel):
    dimension: str
    score: float
    evidence_event_ids: list[str]=Field(default_factory=list)
    notes: str=""
class Report(BaseModel):
    attempt_id: str
    challenge_id: str
    candidate_name: str
    functional_score: float
    ai_collaboration_score: float
    total_score: float
    breakdown: list[DimensionScore]=Field(default_factory=list)
    timeline: list[SessionEvent]=Field(default_factory=list)
class TokenBudgetSummary(BaseModel):
    budget: int
    used: int
    remaining: int
    by_phase: dict[str,int]=Field(default_factory=dict)
    budget_exceeded: bool=False
    hard_stop: bool=False
class UserCreate(BaseModel):
    company_name: str
    name: str
    email: str
    password: str
class LoginRequest(BaseModel):
    email: str
    password: str
class User(BaseModel):
    id: str
    company_name: str
    name: str
    email: str
class UserRecord(User):
    password_hash: str
class AuthResponse(BaseModel):
    token: str
    user: User

class SandboxSessionInfo(BaseModel):
    """Runtime info for one attempt's sandbox session (app/sandbox.py).

    Sessions are runtime state: after a backend restart the workspace
    stays on disk but status is "not_started" until start is called again.
    """
    attempt_id: str
    session_id: str=""
    workspace_id: str=""
    workspace_path: str=""
    backend: str=""               # "local" | "docker" | "" (not started)
    backend_note: str=""
    status: str="not_started"     # not_started | active | stopped | frozen | expired
    ws_url: str=""
    started_at: str=""
    expires_at: str=""
    time_limit_minutes: int=0

class Replay(BaseModel):
    attempt_id: str
    session_id: str=""
    status: str="in_progress"
    events: list[SessionEvent]=Field(default_factory=list)
    git_snapshots: list[dict[str,Any]]=Field(default_factory=list)
    token_budget: Optional[TokenBudgetSummary]=None

class MeUpdate(BaseModel):
    name: Optional[str]=None
    company_name: Optional[str]=None
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
class OrgInfo(BaseModel):
    company_name: str
    member_count: int
    challenge_count: int
    attempt_count: int

class SessionStatus(BaseModel):
    attempt_id: str
    status: str
    started_at: str=""
    expires_at: str=""
    elapsed_seconds: int=0
    remaining_seconds: int=0
    time_limit_minutes: int=0
    budget: Optional[TokenBudgetSummary]=None
    sandbox_status: str="not_started"
