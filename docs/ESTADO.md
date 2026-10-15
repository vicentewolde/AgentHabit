# Estado del proyecto

> La memoria de trabajo entre sesiones. `/estado` lo lee al empezar y `/tarea` lo actualiza al
> terminar. Se mantiene corto: la narrativa vive en la `BITACORA.md` de la fase.
>
> Leyenda: ⏳ pendiente · 🔨 en curso · 👀 en revisión · ✅ terminada · ⛔ bloqueada ·
> ✂️ cortada · ⏸ en pausa

**Actualizado:** 2026-10-15
**Fase en curso:** Fase 0 · Fundamentos. Su spec es el
[mensaje inicial](fase-0-fundamentos/claude-code-mensaje-inicial.md), sección "Fase 0".

**Última tarea terminada:** ninguna todavía. T1 está en revisión.
**Siguiente paso:** `/revisar` sobre `cc/t1-repo-y-metodo`; después, con el OK del usuario, crear
el repo en GitHub y abrir el primer PR. Luego `/tarea T2`.

## Progreso de la Fase 0

| Tarea | Estado | Rama / PR |
|---|---|---|
| T1 Repo y método | 👀 en revisión: estructura compilando, método, registros; `pnpm check` en verde ([evidencia](fase-0-fundamentos/evidencia/T1.md)) | `cc/t1-repo-y-metodo` |
| T2 Herramientas y claves | ⏳ pendiente | |
| T3 `/fase-plan 1` | ⏳ pendiente | |

## Pendientes del usuario

- Aprobar `gh repo create vicentewolde/AgentHabit --public` y el primer PR (cierra T1).
- El primer PR necesita una rama `main` en GitHub como base: decidir cómo nace (ver
  [bitácora](fase-0-fundamentos/BITACORA.md), T1).

## Notas

- **Dejado para T2, a propósito:** el job de Foundry en CI, `foundry.toml` con versión de solc,
  `soroban-sdk`, forge-std y OpenZeppelin (versiones que se resuelven en vivo), y los scripts
  `bootstrap.ts`, `deploy-stellar.ts`, `deploy-avalanche.ts` y `scripts/lib/`. Los
  `deployments/*.json` los escribe T7.
- Foundry no está instalado en la Mac todavía: `pnpm run contracts:test:evm` falla hasta T2.
- Node local es 26.9; el proyecto fija 22 (`.nvmrc`, `P-5`). `pnpm check` pasa en 26.
