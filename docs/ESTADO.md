# Estado del proyecto

> La memoria de trabajo entre sesiones. `/estado` lo lee al empezar y `/tarea` lo actualiza al
> terminar. Se mantiene corto: la narrativa vive en la `BITACORA.md` de la fase.
>
> Leyenda: ⏳ pendiente · 🔨 en curso · 👀 en revisión · ✅ terminada · ⛔ bloqueada ·
> ✂️ cortada · ⏸ en pausa

**Actualizado:** 2026-10-15
**Fase en curso:** Fase 0 · Fundamentos. Su spec es el
[mensaje inicial](fase-0-fundamentos/claude-code-mensaje-inicial.md), sección "Fase 0".

**Última tarea terminada:** T1 Repo y método ([PR #1](https://github.com/vicentewolde/AgentHabit/pull/1), mergeado el 15-oct por fast-forward).
**En revisión:** T2 Herramientas y claves, en la rama `cc/t2-herramientas-y-claves`.
**Siguiente paso:** push y PR de T2, con tu OK. `/revisar` ya está hecho y sus hallazgos corregidos.

## Progreso de la Fase 0

| Tarea | Estado | Rama / PR |
|---|---|---|
| T1 Repo y método | ✅ terminada: estructura compilando, método, registros; `pnpm check` y `cargo test` en verde en CI; `/revisar` sin bloqueantes, hallazgos corregidos ([evidencia](fase-0-fundamentos/evidencia/T1.md)) | [PR #1](https://github.com/vicentewolde/AgentHabit/pull/1), mergeado |
| T2 Herramientas y claves | 👀 en revisión: herramientas fijadas (`P-8`, `P-9`), contratos vacíos que compilan y testean, `pnpm run bootstrap` corrido contra testnet; `/revisar` con 1 bloqueante y 10 hallazgos más, todos corregidos ([evidencia](fase-0-fundamentos/evidencia/T2.md)) | `cc/t2-herramientas-y-claves` |
| T3 `/fase-plan 1` | ⏳ pendiente | |

## Pendientes del usuario

- Agregar Foundry al `PATH`, por ejemplo con
  `echo 'export PATH="$PATH:$HOME/.foundry/bin"' >> ~/.zshrc`, porque el instalador no lo hizo.
- **Para T7, no bloquea T3:** pedir AVAX de prueba para las tres direcciones de Fuji y USDC de
  prueba para el usuario de prueba, a mano. Las direcciones están al final de la salida de
  `pnpm run bootstrap`.
- Pegar una salida real de `/estado` en [evidencia/T1.md](fase-0-fundamentos/evidencia/T1.md):
  ya se corrió en la sesión de T2.

## Notas

- **Desvío del plan (`P-8`), aceptado por el usuario el 15-oct:** el contrato de Soroban se compila con
  `stellar contract build` (`pnpm run contracts:build:stellar`), porque `soroban-sdk` 29 no acepta
  `cargo build --release --target wasm32v1-none`. CI hace lo mismo.
- Para correr un segundo bootstrap si el primero quedó colgado: el lock `.env.local.lock` se
  retoma solo si su proceso murió.
- Los jobs nuevos de CI (`stellar contract build` y `forge test`) todavía no corrieron en GitHub:
  se ven en el PR de T2.
- Friendbot creó cuentas el 15-oct sin responder la petición. El bootstrap confía en el ledger, no
  en Friendbot (`P-10`).
- Node local es 26.9; el proyecto fija 22 (`.nvmrc`, `P-5`). `pnpm check` pasa en 26.
