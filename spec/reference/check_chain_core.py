"""Escenarios core muy pequeños, ejecutables sin dependencias ni MCode."""
from goal_chain_core import Candidate, Goal, Snapshot, decide

backlog = (
    Candidate('p1', 'Reproducir y corregir bug', 10, ('error observado',), ('test mínimo pasa',)),
    Candidate('p2', 'Integrar mejora', 8, ('petición explícita',), ('comportamiento validado',), ('p1',)),
)
base = {'mission_status': 'running', 'current_goal': None,
        'completed_goal_ids': frozenset(), 'completed_candidate_ids': frozenset(), 'candidates': backlog}
assert decide(Snapshot(**base)).candidate_id == 'p1'
assert decide(Snapshot(**{**base,'current_goal':Goal('tg1','primero','active')})).kind == 'observe'
assert decide(Snapshot(**{**base,'current_goal':Goal('tg1','primero','blocked')})).kind == 'escalate'
assert decide(Snapshot(**{**base,'current_goal':Goal('tg1','primero','complete')})).kind == 'observe'
assert decide(Snapshot(**{**base,'current_goal':Goal('tg1','primero','complete'),
    'completed_goal_ids':frozenset({'tg1'}), 'completed_candidate_ids':frozenset({'p1'})})).candidate_id == 'p2'
assert decide(Snapshot(**{**base, 'candidates': tuple()})).kind == 'park'
assert decide(Snapshot(**{**base,'mission_status':'paused'})).kind == 'park'
assert decide(Snapshot(**{**base,'candidates':(Candidate('bad','sin evidencia',11,(),('terminado',)),)})).kind == 'park'
print('OK: 8 comprobaciones puras (sin ACP).')
