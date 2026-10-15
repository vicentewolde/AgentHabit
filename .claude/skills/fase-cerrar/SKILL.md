---
name: fase-cerrar
description: Cierra una fase — verifica los criterios de aceptación con evidencia, entrega la demo, revisa la coherencia entre docs y código, y actualiza roadmap, bitácora, estado y changelog.
argument-hint: "[numero-de-fase]"
disable-model-invocation: true
---

# /fase-cerrar $ARGUMENTS — Cerrar la fase

Contexto:
- Rama: !`git branch --show-current`
- Cambios sin commitear: !`git status --short`

## Pasos
1. **Precondiciones.** Estás en `main`, al día con `origin/main`, y todas las tareas de la fase están ✅ o ✂️ (cortadas, con el motivo) en `docs/ESTADO.md`. Si no, lista lo que falta y detente.

2. **Verificación.** Para cada criterio de aceptación del spec:
   - Ejecuta el comando o test que lo demuestra y muestra la evidencia. Lo que toca testnet o mueve fondos, solo con el OK del usuario.
   - Márcalo `[x]` solo si quedó demostrado.
   - Los que requieren acción humana (correr con la cuenta de Strava, aprobar en la wallet) quedan como checklist para el usuario.

3. **Demo.** Entrega el "Plan de demo" del spec como pasos exactos y espera la confirmación del usuario.

4. **Coherencia.** Pide al subagente `arquitecto` que revise la desviación entre los docs de la fase y el código (contratos, `deployments/`, la tabla de casos compartida). Corrige los docs desactualizados en una rama `cc/fase<n>-cierre`.

5. **Registro.**
   - Spec: estado **Cerrado**, más una fila en el registro de cambios.
   - `BITACORA.md` de la fase: **Estado actual** con "Cerrada" y el rango de tareas.
   - `ROADMAP.md` y la tabla de `CLAUDE.md`: la fase como cerrada.
   - `docs/ESTADO.md`: fase siguiente y siguiente paso `/fase-plan <n+1>`.
   - `CHANGELOG.md`: mueve `[Sin publicar]` a la versión de la fase (Fase 0 `v0.0.1`, Fase 1 `v0.1.0`, Fase 2 `v0.2.0`, Fase 3 `v0.3.0`) con un párrafo en lenguaje llano.

6. **Retro breve.** Tres líneas: qué funcionó, qué no, y qué cambiar en la próxima fase. Si algo afecta la forma de trabajar, propón editar `CLAUDE.md` o las skills.

Los cambios del cierre entran a `main` como cualquier tarea: PR y fast-forward con el OK del usuario. El tag de la fase (`git tag v0.<n>.0`) se crea y se pushea **solo con permiso explícito del usuario**.
