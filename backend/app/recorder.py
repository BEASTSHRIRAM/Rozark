"""Recorder — the ONLY writer of the session event log.

Implements docs/EVENT_LOG_SCHEMA.md: append-only, one ordered log per
session. The recorder assigns id / seq / ts (callers never do), tracks the
token budget from token_usage events, and flips the hard-stop flags the
moment cumulative usage reaches the cap (enforcement itself lives at the
budget proxy — see docs/SANDBOX.md; these flags are the backend mirror).
"""
from __future__ import annotations
from datetime import datetime, timezone
from .models import Actor, Attempt, EventType, SessionEvent, SessionEventCreate, TokenBudgetSummary
from .store import store

# Event types that mean "the agent is being used" — refused once the hard
# stop is active, so a capped session cannot keep spending.
_AGENT_ACTIVITY = {EventType.prompt, EventType.tool_call, EventType.agent_response}

class BudgetHardStop(Exception):
    """Raised when agent activity is submitted after the token cap."""

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

class Recorder:
    def append(self, attempt: Attempt, body: SessionEventCreate) -> SessionEvent:
        if attempt.budget_hard_stop and body.type in _AGENT_ACTIVITY:
            raise BudgetHardStop(
                f"Token budget hard stop is active for attempt {attempt.id} "
                f"({attempt.tokens_used}/{attempt.token_budget} tokens used)."
            )
        seq = len(attempt.events) + 1
        ev = SessionEvent(
            id=store.next_event_id(),
            attempt_id=attempt.id,
            session_id=attempt.session_id or attempt.id,
            sequence=seq,
            seq=seq,
            ts=_now_iso(),
            **body.model_dump(),
        )
        attempt.events.append(ev)
        if ev.type == EventType.token_usage:
            self._apply_token_usage(attempt, ev)
        return ev

    def _apply_token_usage(self, attempt: Attempt, ev: SessionEvent) -> None:
        p = ev.payload
        total = p.get("tokens_total")
        if total is None:
            total = int(p.get("tokens_in", 0)) + int(p.get("tokens_out", 0))
        total = int(total)
        attempt.tokens_used += total
        phase = str(p.get("phase", "building"))
        attempt.tokens_by_phase[phase] = attempt.tokens_by_phase.get(phase, 0) + total
        # Denormalise cumulative figures onto the event for the budget bar.
        p["cumulative_tokens"] = attempt.tokens_used
        p["budget"] = attempt.token_budget
        p["budget_remaining"] = max(attempt.token_budget - attempt.tokens_used, 0)
        if attempt.tokens_used >= attempt.token_budget and not attempt.budget_exceeded:
            attempt.budget_exceeded = True
            attempt.budget_hard_stop = True
            # The cap crossing is itself evidence — record it (recursion-safe:
            # budget_exceeded is not a token_usage event).
            self.append(attempt, SessionEventCreate(
                type=EventType.budget_exceeded, actor=Actor.system,
                payload={"cumulative_tokens": attempt.tokens_used,
                         "budget": attempt.token_budget, "phase": phase},
            ))

    def ordered_events(self, attempt: Attempt) -> list[SessionEvent]:
        return sorted(attempt.events, key=lambda e: e.seq)

    def budget_summary(self, attempt: Attempt) -> TokenBudgetSummary:
        return TokenBudgetSummary(
            budget=attempt.token_budget,
            used=attempt.tokens_used,
            remaining=max(attempt.token_budget - attempt.tokens_used, 0),
            by_phase=dict(attempt.tokens_by_phase),
            budget_exceeded=attempt.budget_exceeded,
            hard_stop=attempt.budget_hard_stop,
        )

recorder = Recorder()
