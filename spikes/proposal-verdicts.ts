/**
 * Sonda: que verdicts da el codigo de hoy a las propuestas de la mision.
 * Se ejecuta con el codigo del arbol de trabajo, no con el del plugin vivo.
 */
import { reviewProposals, readProposals } from '../src/adapters/proposals.js';

const missionId = process.argv[2] ?? 'goal-compass-loop';
const workspace = process.argv[3] ?? process.cwd();

const propuestas = readProposals(missionId);
console.log(`propuestas en el fichero: ${propuestas.length}`);

const verdicts = reviewProposals(missionId, workspace);
for (const verdict of verdicts) {
  const evidencia = verdict.proposal.evidenceRefs.join(', ');
  console.log(
    `${verdict.defect === null ? 'UTIL' : 'DESC'}  [${verdict.defect ?? '-'}]  ${verdict.proposal.objective.slice(0, 62)}`,
  );
  console.log(`        evidencia: ${evidencia}`);
}
console.log(
  `\nutilizables: ${verdicts.filter((v) => v.defect === null).length} / ${verdicts.length}`,
);
