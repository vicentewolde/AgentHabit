---
name: fase-plan
description: Redacta o revisa el spec de una fase y lo deja aprobado por el usuario, antes de escribir código.
argument-hint: "[numero-de-fase]"
disable-model-invocation: true
---

# /fase-plan $ARGUMENTS — Planificar la fase

Objetivo: dejar `docs/fase-$ARGUMENTS-…/SPEC.md` en estado **Aprobado**, con tareas pequeñas, ordenadas y verificables.

## Pasos

1. **Contexto.** Lee `docs/ESTADO.md`, `ROADMAP.md`, `docs/DECISIONES.md` y el `DECISIONES.md` de la fase. Para la Fase 1, el borrador de tareas está en `docs/fase-0-fundamentos/claude-code-mensaje-inicial.md`. Confirma que lo que la fase pide está en alcance según la regla 5 de `CLAUDE.md`; si no, detente y pregunta.

2. **Spec.**
   - Si **no existe**, créalo con estas secciones (las del spec de la Fase 9 de AgentPey): encabezado (estado, rama base, tareas, fechas, referencias), objetivo, alcance, fuera de alcance, diseño, tareas, criterios de aceptación, plan de demo, orden y cortes, riesgos, preguntas abiertas y registro de cambios.
   - Si **existe en borrador**, revísalo contra el código real (lee los paquetes y los contratos, no supongas).
   - Si la fase integra un servicio o red externa (Strava, Circle, Stellar, Avalanche), verifica primero su documentación oficial vigente y cita URL y fecha. Para Strava, delega en el subagente `integraciones`.

3. **Tareas.** Cada tarea:
   - Lleva el siguiente número T de la numeración continua.
   - Idealmente cabe en medio día; si es más grande, pártela o justifícalo.
   - Tiene dependencias explícitas, archivos principales y "Hecho cuando" verificable.
   - Dice si toca el perímetro de fondos (contratos, claves, oráculo, `settle`, despliegues): esas tareas piden permiso antes de tocar la red.

4. **Preguntas al usuario.** Toda decisión de producto, de fondos, de contratos o que dependa de sus cuentas va a "Preguntas abiertas". Házselas (máximo 4, concretas, con opciones y tu recomendación) y actualiza el spec con las respuestas.

5. **Aprobación.** Muestra un resumen: objetivo, número de tareas, riesgos principales y decisiones nuevas. Si conviene, pide al subagente `arquitecto` que revise el spec antes. Solo cuando el usuario diga que aprueba:
   - Cambia el estado del spec a **Aprobado** y agrega una fila al registro de cambios.
   - Actualiza la tabla de progreso de `docs/ESTADO.md` y `ROADMAP.md`.

No escribas código de la aplicación en este comando.
