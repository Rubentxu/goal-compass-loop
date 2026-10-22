/**
 * Los ADR son la memoria de las decisiones, y se degradan sin que se note:
 * un ADR sin contexto es un titular, y un ADR sin decir que invalida es un
 * documento que no dice si hay que cambiar algo.
 *
 * Estas pruebas comprueban la forma, no el contenido: que cada ADR tenga las
 * secciones que hacen que se pueda leer, que los que dejan algo obsoleto lo
 * digan, y que los dos huecos normativos del roadmap esten escritos.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(fileURLToPath(new URL('..', import.meta.url)));
const adrDir = join(raiz, 'docs', 'adr');

/** Las secciones que hacen que un ADR se pueda leer y usar. */
const SECCIONES = [
  '## Contexto',
  '## Decisión',
  '## Alternativas descartadas',
  '## Consecuencias',
];

/** La seccion que dice que queda obsoleto. */
const SECCION_FIXTURE = '## Qué fixture deja de ser válido';

/**
 * Desde que ADR la exigencia de declarar que queda obsoleto es de todos.
 *
 * El roadmap (p6) pide que cada ADR lo diga "si deja algo": los ADR
 * anteriores no invalidaban ningun fixture, asi que a partir de este
 * numero la seccion es obligatoria. Los anteriores se admiten con o sin
 * ella, para que normalizarlos no rompa la suite.
 */
const PRIMER_ADR_CON_EXIGENCIA = 5;

function adrs(): string[] {
  return readdirSync(adrDir)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

/** El numero del ADR, o cero si el nombre no lo lleva. */
function numero(name: string): number {
  const encontrado = /^ADR-(\d+)/.exec(name);
  return encontrado ? Number(encontrado[1]) : 0;
}

/** El texto de una seccion, o cadena vacia si el ADR no la tiene. */
function seccion(contenido: string, titulo: string): string {
  const partes = contenido.split(titulo);
  return partes.length > 1 ? (partes[1] ?? '').split('\n## ')[0] ?? '' : '';
}

/**
 * Los ficheros que el ADR cita entrecomillados: lo que deja de ser valido
 * tiene que existir en el repositorio, o no se puede comprobar nada.
 */
function ficherosCitados(texto: string): string[] {
  const citas = [...texto.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
  return citas.filter((c) => /\.[a-z]+$/.test(c) || c.includes('/'));
}

describe('los ADR tienen la forma que hace falta para leerlos', () => {
  it('hay ADR, y ninguno esta vacio', () => {
    const lista = adrs();
    expect(lista.length).toBeGreaterThan(0);
    for (const name of lista) {
      const contenido = readFileSync(join(adrDir, name), 'utf8');
      expect(contenido.trim().length, `${name} esta vacio`).toBeGreaterThan(0);
    }
  });

  it('cada ADR dice su contexto, su decision, lo descartado y sus consecuencias', () => {
    for (const name of adrs()) {
      const contenido = readFileSync(join(adrDir, name), 'utf8');
      for (const titulo of SECCIONES) {
        expect(contenido.includes(titulo), `${name} no tiene la seccion "${titulo}"`).toBe(true);
      }
    }
  });

  it('los ADR que invalidan algo dicen que, y lo que invalidan existe', () => {
    for (const name of adrs()) {
      if (numero(name) < PRIMER_ADR_CON_EXIGENCIA) continue;
      const contenido = readFileSync(join(adrDir, name), 'utf8');
      expect(
        contenido.includes(SECCION_FIXTURE),
        `${name} no tiene la seccion "${SECCION_FIXTURE}"`,
      ).toBe(true);

      const citados = ficherosCitados(seccion(contenido, SECCION_FIXTURE));
      const existentes = citados.filter((f) => existsSync(join(raiz, f)));
      expect(
        existentes.length,
        `${name} no cita ningun fichero que exista: ${citados.join(', ') || 'ninguno'}`,
      ).toBeGreaterThan(0);
    }
  });

  it('las dos decisiones que mas cambiaron el contrato tienen su ADR', () => {
    // El arbol como dato, y la declaracion como puerta con identificador
    // derivado: las dos que el roadmap pedia y no estaban escritas.
    expect(existsSync(join(adrDir, 'ADR-005-el-arbol-como-dato.md'))).toBe(true);
    expect(existsSync(join(adrDir, 'ADR-006-la-declaracion-como-puerta.md'))).toBe(true);
  });
});
