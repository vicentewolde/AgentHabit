---
name: revisar
description: Revisión del trabajo en la rama actual frente al spec, los criterios transversales y el perímetro de fondos, usando el subagente revisor.
argument-hint: "[id-tarea opcional]"
disable-model-invocation: true
---

# /revisar — Revisión de la rama actual

Contexto:
- Rama: !`git branch --show-current`
- Archivos cambiados respecto a main: !`git diff --stat main...HEAD 2>/dev/null || echo "(sin main todavía: revisar contra la raíz)"`

## Pasos
1. Identifica la tarea (argumento `$ARGUMENTS`, o el nombre de la rama) y su sección en el spec de la fase (`docs/fase-<n>-…/SPEC.md`; en la Fase 0, `docs/fase-0-fundamentos/claude-code-mensaje-inicial.md`).
2. Delega en el subagente **`revisor`**, pasándole:
   - el id de la tarea y la ruta del spec,
   - que revise `git diff main...HEAD` completo,
   - que corra `pnpm check`, y los tests de contratos si el diff toca `contracts/`.
   Pásale el diff y el spec, no tu conclusión: la revisión vale porque no está anclada a la tuya.
3. Si el diff toca `contracts/`, los adaptadores de cadena, `apps/settler`, `SETTLE_MODE`, claves, `deployments/` o los scripts de despliegue, revisa **tú mismo** además esas partes línea por línea: un error ahí deja fondos bloqueados o mal liquidados.
4. Presenta los hallazgos consolidados, sin duplicados, máximo 15, en tres grupos:
   - 🔴 **Bloqueantes:** hay que arreglarlos antes del PR
   - 🟡 **Importantes:** arreglar ahora o dejar como deuda anotada en `docs/ESTADO.md`
   - 🟢 **Sugerencias**
5. Pregunta al usuario cuáles corregir. Corrige solo esos, vuelve a correr `pnpm check` y haz commit (`fix(...)` o `refactor(...)`, por nombre de archivo).

No hagas push ni merge desde este comando. El merge está descrito al final de `/tarea` y necesita el OK del usuario.
