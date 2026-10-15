---
name: tarea
description: Ejecuta una tarea del spec de punta a punta — rama, plan, implementación con tests, verificación, documentación y commit. Para y muestra el resultado.
argument-hint: "[id-tarea, ej. T4]"
disable-model-invocation: true
---

# /tarea $ARGUMENTS — Ejecutar una tarea

Estado del repositorio:
- Rama actual: !`git branch --show-current`
- Cambios sin commitear: !`git status --short`
- Últimos commits: !`git log --oneline -3`

`CLAUDE.md` manda sobre esta skill. Una tarea a la vez: al cerrarla, **para y muestra el resultado** (regla 1).

## 1. Preparar
- Lee `docs/ESTADO.md` y la sección **$ARGUMENTS** del spec de la fase actual (`docs/fase-<n>-…/SPEC.md`).
- El spec debe estar **Aprobado**. Si no, detente y sugiere `/fase-plan`. Excepción: la Fase 0 no tiene `SPEC.md`; su spec es `docs/fase-0-fundamentos/claude-code-mensaje-inicial.md`, sección "Fase 0", aprobado por el usuario al empezar.
- Verifica que sus dependencias estén ✅ en ESTADO. Si no, detente y avisa.
- Si hay **cambios** sin commitear que no son de esta tarea, detente y pregunta.
- Confirma rama y HEAD, y crea la rama explícitamente desde `origin/main`:
  ```bash
  git fetch origin && git checkout -b cc/<id-en-minúsculas>-<slug> origin/main
  ```
- Marca la tarea 🔨 en `docs/ESTADO.md`.

## 2. Planificar
Primero 3 o 4 líneas en lenguaje llano de qué vas a hacer (regla 3). Después:
- Archivos a crear o modificar
- Pasos en orden
- Tests que vas a escribir
- **Perímetro de fondos:** si algo toca los contratos, las claves (deployer, oráculo, usuario de prueba), `settle`/`release_if_stale`, `SETTLE_MODE`, los adaptadores de cadena o `deployments/`, dilo explícitamente. Un contrato nuevo, un despliegue o cualquier cosa que mueva fondos (aunque sea testnet) necesita permiso del usuario antes (regla 8).
- **Datos de Strava:** si la tarea los toca, confirma que no llegan a ninguna función de IA y que se respeta el cache de 7 días.
- Dudas o supuestos

**Espera el OK del usuario antes de editar**, salvo que la tarea sea trivial (1 o 2 archivos sin decisiones).

## 3. Implementar
- En incrementos pequeños, con los tests del comportamiento junto con el código. Los nombres de los tests son frases de comportamiento.
- Criterios transversales de `CLAUDE.md`: errores tipados (`AgentHabitError` + `code`), zod en todo borde, nada de `any`, montos en `bigint` con los decimales del token (7 en Stellar, 6 en Avalanche), sin credenciales en el código ni en logs. Código y comentarios en inglés.
- Si la tarea toca la semántica del contrato, la tabla de casos compartida de `packages/core` es la fuente: las dos cadenas pasan los mismos casos.
- Nunca debilites un test para que pase.
- Si el spec está mal o incompleto: detente, explícalo y propón el cambio al spec antes de seguir.
- Si una decisión de algún `DECISIONES.md` parece equivocada: muestra la evidencia, propón la alternativa y **espera** (regla 2).
- Si aparece algo fuera de alcance: anótalo en ESTADO y déjalo sin construir (regla 5).

## 4. Verificar
- `pnpm check` completo.
- Si toca contratos: `pnpm run contracts:test:stellar` y/o `pnpm run contracts:test:evm` (`export PATH="/opt/homebrew/opt/rustup/bin:$PATH"`).
- Despliegues, `settle --live` y cualquier cosa contra testnet que mueva fondos: solo con el OK del usuario.
- Revisa uno por uno los "Hecho cuando" de la tarea y demuestra cada uno con un comando, una salida o un test.

## 5. Documentar
- `BITACORA.md` de la fase: **Estado actual** y el bloque de la tarea en lenguaje llano.
- `evidencia/$ARGUMENTS.md` de la fase: las salidas crudas (sin secretos ni datos reales de Strava).
- Toda decisión nueva, con motivo y alternativa descartada, al `DECISIONES.md` de la fase (o `docs/DECISIONES.md` con `P-` si cruza fases).
- `docs/ESTADO.md`: tarea 👀, siguiente paso y notas breves.
- `CHANGELOG.md`: una línea en `[Sin publicar]` si cambió algo visible.

## 6. Commit
- `git add` **por nombre de archivo**, nunca un directorio ni `-A`.
- Mensajes en inglés, Conventional Commits, que expliquen el **porqué**.
- **`push`, PR y merge solo con autorización explícita del usuario para esta rama.** Un permiso anterior no sirve para otra rama.

## 7. Cerrar
Responde al usuario, en este orden:
1. **Qué quedó funcionando**, en palabras que entienda alguien no técnico
2. **Evidencia técnica** (3 a 5 viñetas) y **cómo probarlo** (comandos exactos)
3. **Siguiente paso:** `/revisar`

Y detente ahí. No empieces otra tarea.

## Merge (después de `/revisar`, con el OK del usuario)
1. `git push -u origin <rama>` y `gh pr create`, con un cuerpo que enlace la tarea del spec.
2. Con el OK del usuario para el merge: fast-forward a `main`. Antes de pushear `main`, lista `git log origin/main..main` y confirma que cada commit es de esta tarea y está aprobado.
3. Borra la rama y marca la tarea ✅ en `docs/ESTADO.md`.
