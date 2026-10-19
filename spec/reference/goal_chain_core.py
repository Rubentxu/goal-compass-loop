"""Modelo PURO demostrativo Goal->Goal. No implementa un cliente ACP ni I/O.

La política real se extiende en M1; mantén el núcleo funcional, pequeño y tipado.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal, NamedTuple

GoalStatus = Literal['active', 'paused', 'blocked', 'complete', 'budget_limited', 'usage_limited']
MissionStatus = Literal['running', 'parked', 'paused', 'stopped']

@dataclass(frozen=True)
class Goal:
    goal_id: str
    objective: str
    status: GoalStatus

@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    objective: str
    priority: int
    evidence: tuple[str, ...]
    done_when: tuple[str, ...]
    prerequisites: tuple[str, ...] = ()
    risk: Literal['low', 'medium', 'high'] = 'low'

@dataclass(frozen=True)
class Snapshot:
    mission_status: MissionStatus
    current_goal: Goal | None
    completed_goal_ids: frozenset[str]
    completed_candidate_ids: frozenset[str]
    candidates: tuple[Candidate, ...]
    token_budget_per_goal: int = 30_000

class Decision(NamedTuple):
    kind: Literal['observe', 'create', 'park', 'escalate']
    reason: str
    candidate_id: str | None = None
    objective: str | None = None


def decide(snapshot: Snapshot) -> Decision:
    """Produce una intención, jamás crea un Goal; I/O corresponde al supervisor."""
    if snapshot.mission_status != 'running':
        return Decision('park', f'mission_{snapshot.mission_status}')
    goal = snapshot.current_goal
    if goal and goal.status == 'active':
        return Decision('observe', 'native_goal_running')
    if goal and goal.status != 'complete':
        return Decision('escalate', f'native_goal_{goal.status}')
    if goal and goal.goal_id not in snapshot.completed_goal_ids:
        return Decision('observe', 'goal_completion_not_journaled')
    if snapshot.token_budget_per_goal <= 0:
        return Decision('escalate', 'invalid_token_budget')
    eligible = tuple(
        c for c in snapshot.candidates
        if c.candidate_id not in snapshot.completed_candidate_ids
        and c.objective.strip() and c.evidence and c.done_when
        and c.risk != 'high'
        and all(req in snapshot.completed_candidate_ids for req in c.prerequisites)
    )
    if not eligible:
        return Decision('park', 'no_evidence_backed_candidate; discover_only_on_new_signal')
    pick = sorted(eligible, key=lambda c: (-c.priority, c.candidate_id))[0]
    return Decision('create', 'eligible_candidate', pick.candidate_id, pick.objective)
