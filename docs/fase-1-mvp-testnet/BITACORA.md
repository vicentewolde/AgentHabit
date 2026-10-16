# Bitácora — Fase 1 (MVP en testnet)

> Qué se hizo, qué falta, y qué significa cada cosa en lenguaje llano.
>
> - Spec: [SPEC.md](SPEC.md)
> - Decisiones: las `A-` de [DECISIONES.md](DECISIONES.md)
> - Salidas crudas de cada tarea: `evidencia/T<n>.md`
>
> La numeración es continua entre fases: la Fase 1 usa T4 a T9. El tablero del día a día es
> [`docs/ESTADO.md`](../ESTADO.md); aquí queda la narrativa de cada tarea cerrada.

---

## Estado actual

**Fecha:** 2026-10-16 · **Fase en curso** desde el cierre de la Fase 0 (`v0.0.1`). Spec **Aprobado** en T3.
T4 implementada en `cc/t4-nucleo-y-contratos`, en revisión: los dos contratos existen y pasan la misma tabla de
casos. Siguiente: `/revisar`; después T5 (puede correr en paralelo) y T6.

## Progreso

Tareas agrupadas el 16-oct para ganar velocidad (equivalencias en el registro de cambios del spec).

| Tarea | Estado |
|---|---|
| T4 Núcleo y contratos | 👀 en revisión |
| T5 Strava, API y km de la semana | ⏳ pendiente |
| T6 Despliegue en testnet y liquidación | ⏳ pendiente |
| T7 Web | ⏳ pendiente |
| T8 Ensayo de punta a punta y publicación en Render | ⏳ pendiente |
| T9 `/fase-cerrar 1` | ⏳ pendiente |

---

## T4 · Núcleo y contratos

**Qué quedó funcionando.** Ya existen los dos contratos que guardan el dinero, uno para Avalanche y otro para Stellar,
y se comportan igual. Los dos hacen exactamente tres cosas con fondos:
- **comprometer:** el usuario bloquea entre 20 y 50 USDC para la semana siguiente;
- **liquidar:** el oráculo dice "cumplió" (se devuelve todo) o "no cumplió" (el dinero queda en el contrato para
  siempre);
- **devolver por plazo vencido:** si el oráculo no liquidó a tiempo, cualquiera puede devolverle el depósito a su
  dueño, sin fecha límite.

No hay ninguna otra forma de sacar dinero, y nadie (ni el equipo) puede cambiar las reglas.

Para que las dos cadenas no se separen, hay una sola lista de situaciones escrita una vez en el núcleo común: **44
casos con 126 pasos**. Cubren los bordes de las semanas, cada error, el orden en que se revisan los errores, el
token que rechaza una devolución y varias semanas seguidas. Los dos contratos leen esa misma lista y la pasan entera.
Si alguien cambia un contrato y rompe una regla, la lista lo detecta. Se probó metiendo un error a propósito: las dos
cadenas fallaron en el mismo caso.

Todo corre en tests locales: no se desplegó nada ni se tocó la red con fondos.

**Lo que cambió respecto del plan.**
- **Los errores del contrato de Stellar se numeran desde 101** (`A-12`). La primera corrida de la lista mostró que un
  error del token de USDC llegaba con el mismo número que uno nuestro y se confundían. En la red habría pasado igual.
- **El TTL de Soroban quedó en 30 y 31 días** (`A-13`), con los límites leídos de la red el 16-oct. Además, un test
  deja pasar 40 días sin escrituras: la posición se archiva, se restaura al tocarla y la devolución funciona.
- **El orden de validación quedó fijado por función** (`A-14`), con un caso por cada par vecino.
- **Hay un modelo de referencia en TypeScript.** Corre la lista con las funciones del núcleo antes de llegar a los
  contratos, así un caso mal escrito falla primero ahí. No estaba en el spec y no agrega alcance: es un test.
- **El ancla de cada instancia se elige al desplegar** (T6). El núcleo trae los parámetros de producción y de ensayo
  sin ancla, y `instanceParams` la recibe y valida todo con las reglas del constructor.

**Decisiones nuevas.** `A-12`, `A-13` y `A-14`.

**Evidencia.** [`evidencia/T4.md`](evidencia/T4.md).
