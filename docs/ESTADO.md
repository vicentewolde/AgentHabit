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
**Siguiente paso:** que la CI del [PR #1](https://github.com/vicentewolde/AgentHabit/pull/1)
pase y el usuario autorice el merge (fast-forward a `main`). Luego `/tarea T2`.

## Progreso de la Fase 0

| Tarea | Estado | Rama / PR |
|---|---|---|
| T1 Repo y método | 👀 en revisión: estructura compilando, método, registros; `pnpm check` en verde; `/revisar` sin bloqueantes, hallazgos corregidos ([evidencia](fase-0-fundamentos/evidencia/T1.md)) | [PR #1](https://github.com/vicentewolde/AgentHabit/pull/1) |
| T2 Herramientas y claves | ⏳ pendiente | |
| T3 `/fase-plan 1` | ⏳ pendiente | |

## Pendientes del usuario

- Autorizar el merge del [PR #1](https://github.com/vicentewolde/AgentHabit/pull/1) (cierra T1).
- Abrir una sesión de Claude Code en `~/dev/AgentHabit`, escribir `/estado` y pegar la salida en
  [evidencia/T1.md](fase-0-fundamentos/evidencia/T1.md): la prueba real del segundo "Hecho
  cuando" de T1 (en la sesión de T1 se simuló a mano).

## Notas

- **Dejado para T2, a propósito:** el job de Foundry en CI, `foundry.toml` con versión de solc,
  `soroban-sdk`, forge-std y OpenZeppelin (versiones que se resuelven en vivo), y los scripts
  `bootstrap.ts`, `deploy-stellar.ts`, `deploy-avalanche.ts` y `scripts/lib/`. Los
  `deployments/*.json` los escribe T7.
- **"Hecho cuando" que T2 suma por la revisión de T1:** (1) el job de `forge test` en CI, con su
  action fijada por SHA; (2) `cargo build --release --target wasm32v1-none` compila el contrato
  de Soroban, en local y en CI. Hoy el contrato vacío pasa `cargo test` pero no compila para la
  red: falta `#[panic_handler]`, que llega con `soroban-sdk`.
- Foundry no está instalado en la Mac todavía: `pnpm run contracts:test:evm` falla hasta T2.
- Node local es 26.9; el proyecto fija 22 (`.nvmrc`, `P-5`). `pnpm check` pasa en 26.
