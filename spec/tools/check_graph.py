#!/usr/bin/env python3
"""Verificación estática mínima del paquete. No es una prueba E2E de MCode."""
import json
import re
from pathlib import Path
from collections import deque

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / 'plugin'
GRAPH = PLUGIN / 'skills' / 'goal-compass' / 'graph'
MANIFEST = PLUGIN / '.claude-plugin' / 'plugin.json'
REQUIRED = ('## Cuándo entrar', '## Preguntas', '## Acción mínima', '## Criterio de salida', '## Enlaces')
VALID_REL = {'next', 'recover', 'complete', 'escalate', 'inspect', 'discover', 'await'}
LINK = re.compile(r'^- \[([a-z-]+)\]\(([^)]+\.md)\) — rel=([a-z]+); si=([^;]+); evidencia=(.+)$', re.M)
errors = []
def fail(msg): errors.append(msg)
try:
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    if manifest.get('name') != 'goal-compass': fail('manifest.name diferente de goal-compass')
    for p in manifest.get('skills', []):
        ref = PLUGIN / p.removeprefix('./')
        if not ref.is_file(): fail(f'skill no encontrada: {p}')
except (FileNotFoundError, ValueError) as err: fail(f'manifest inválido: {err}')
root_skill = PLUGIN / 'skills' / 'SKILL.md'
child_skill = PLUGIN / 'skills' / 'goal-compass' / 'SKILL.md'
if root_skill.exists() and child_skill.exists():
    if root_skill.read_bytes() != child_skill.read_bytes(): fail('copias SKILL.md difieren')
    if not root_skill.read_text().startswith('---\nname: goal-compass\n'): fail('frontmatter skill incorrecto')
else: fail('falta SKILL.md')
index = GRAPH / 'index.md'
nodes = sorted((GRAPH / 'nodes').glob('*.md'))
if not index.exists(): fail('falta index')
if len(nodes) < 8: fail('insuficientes nodos')
reachable = {}
for path in ([index] if index.exists() else []) + nodes:
    body = path.read_text(encoding='utf-8')
    if path != index:
        for section in REQUIRED:
            if section not in body: fail(f'{path.name}: falta sección {section}')
        if not body.startswith('# ' + path.stem + ' ·'): fail(f'{path.name}: identidad no coincide')
        qsection = body.split('## Preguntas', 1)[-1].split('## Acción mínima', 1)[0]
        questions = re.findall(r'^\d+\. ', qsection, re.M)
        if not (1 <= len(questions) <= 3): fail(f'{path.name}: {len(questions)} preguntas (1..3)')
    edges = []
    for match in LINK.finditer(body):
        label, href, rel, cond, evidence = match.groups()
        dest = (path.parent / href).resolve()
        if rel not in VALID_REL: fail(f'{path.name}: rel inválido {rel}')
        if not cond.strip() or not evidence.strip(): fail(f'{path.name}: cond/evidencia vacío')
        if label != dest.stem: fail(f'{path.name}: label {label} != target {dest.stem}')
        if not dest.is_file(): fail(f'{path.name}: enlace roto {href}')
        if not dest.is_relative_to(GRAPH.resolve()): fail(f'{path.name}: enlace escapa grafo {href}')
        edges.append(dest)
    if not edges: fail(f'{path.name}: sin enlaces reconocibles')
    reachable[path.resolve()] = edges
# Todos los nodos deben ser accesibles desde index y poder alcanzar salida terminal.
seen = set(); queue = deque([index.resolve()])
while queue:
    p = queue.popleft()
    if p in seen: continue
    seen.add(p)
    queue.extend(reachable.get(p, []))
for node in nodes:
    if node.resolve() not in seen: fail(f'nodo inalcanzable desde index: {node.name}')
    discover = set(); q = deque([node.resolve()])
    while q:
        p = q.popleft()
        if p in discover: continue
        discover.add(p)
        if p.stem in {'finish','stop'}: break
        q.extend(reachable.get(p, []))
    else: fail(f'sin salida de terminación: {node.name}')
if errors:
    for err in errors: print('ERROR:', err)
    raise SystemExit(1)
print(f'OK: manifest + copias Skill + {len(nodes)} nodos + enlaces + alcanzabilidad. NO prueba MCode/LLM.')
