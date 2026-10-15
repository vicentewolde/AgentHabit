---
name: estado
description: Resume en qué fase y tarea va AgentHabit, qué hay sin commitear y cuál es el siguiente paso. Usar al abrir cada sesión.
disable-model-invocation: true
---

# /estado — ¿Dónde estamos?

Contexto del repositorio:
- Rama actual: !`git branch --show-current`
- Cambios sin commitear: !`git status --short`
- Últimos commits: !`git log --oneline -10`
- Commits locales que `origin/main` no tiene: !`git log --oneline origin/main..main 2>/dev/null || echo "(sin origin/main todavía)"`

Pasos:
1. Lee `docs/ESTADO.md`.
2. Lee del spec de la fase actual (la ruta está en ESTADO) solo la sección de tareas y los criterios de aceptación. En la Fase 0 el spec es `docs/fase-0-fundamentos/claude-code-mensaje-inicial.md`, sección "Fase 0".
3. Contrasta: ¿la rama, los commits y el árbol de trabajo coinciden con lo que dice ESTADO? Señala lo que no calce: tarea hecha pero no marcada, rama `cc/` sin mergear, cambios sin commitear, commits en `main` que no están en `origin/main`.

Responde en español, breve, con este formato:

**Fase:** Fase N · nombre — X de Y tareas terminadas (spec: borrador / aprobado)
**Rama actual:** … (limpia / con cambios sin commitear)
**Última tarea:** …
**Siguiente paso recomendado:** `/tarea T<n>` — título, en una línea
**Pendientes del usuario:** solo los que bloquean el siguiente paso
**Inconsistencias:** solo si las hay (repo contra ESTADO)

No modifiques archivos en este comando.
