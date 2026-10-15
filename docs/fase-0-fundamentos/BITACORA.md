# Bitácora — Fase 0 (Fundamentos)

> Qué se hizo, qué falta, y qué significa cada cosa en lenguaje llano.
> Spec: el [mensaje inicial](claude-code-mensaje-inicial.md), sección "Fase 0" · Decisiones: las
> `P-` de [../DECISIONES.md](../DECISIONES.md) (la Fase 0 no tiene prefijo propio) · Salidas
> crudas de cada tarea: `evidencia/T<n>.md`
>
> La numeración es continua entre fases: la Fase 0 usa T1 a T3. El tablero del día a día es
> [`docs/ESTADO.md`](../ESTADO.md); aquí queda la narrativa de cada tarea cerrada.

---

## Estado actual

**Fecha:** 2026-10-15 · **T1 cerrada:** repo público en
[vicentewolde/AgentHabit](https://github.com/vicentewolde/AgentHabit), [PR #1](https://github.com/vicentewolde/AgentHabit/pull/1)
mergeado por fast-forward con la CI en verde. Siguiente: T2.

## Progreso

| Tarea | Estado |
|---|---|
| T1 Repo y método | ✅ terminada |
| T2 Herramientas y claves | ⏳ pendiente |
| T3 `/fase-plan 1` | ⏳ pendiente |

---

## T1 · Repo y método

**Qué quedó funcionando.** AgentHabit ya tiene su casa: una carpeta propia con la forma
definitiva del proyecto (la web, la API, el liquidador, el dominio común, un adaptador por cadena
y los dos contratos), todavía vacía pero lista para que cada tarea siguiente la vaya llenando.
Con un solo comando (`pnpm check`) se revisa el estilo, los tipos y los tests, y hoy pasa en
verde. También quedó instalada la forma de trabajar de AgentPey: los comandos `/estado`,
`/tarea`, `/revisar`, `/fase-plan` y `/fase-cerrar`, los tres revisores automáticos, los permisos
que impiden borrar o publicar sin preguntar, y los registros (este archivo, el estado, las
decisiones P-1 a P-7, el plan maestro y el changelog).

**Cómo se conectan las tres herramientas de construcción (`P-2`).** pnpm maneja solo el código
TypeScript (`apps/` y `packages/`). Los dos contratos viven en sus propios workspaces —Cargo en
`contracts/stellar/`, Foundry en `contracts/evm/`— sin `package.json`, así que pnpm no los ve. Se
llaman desde la raíz con `pnpm run contracts:test:stellar` y `pnpm run contracts:test:evm`, fuera
de `pnpm check`. El único puente entre los dos mundos será `deployments/*.json`.

**Qué se copió y qué se escribió desde cero.**
- De AgentPey: las cinco skills, el agente `revisor`, el esqueleto de `CLAUDE.md` con sus reglas,
  el formato de `ESTADO`, `DECISIONES` y la bitácora, `LICENSE`, el layout Cargo y
  `rust-toolchain.toml`. Sin Codex, `AGENT_LOG`, Exponential ni Vitrinee.
- De AgentSales: `settings.json`, los agentes `arquitecto` e `integraciones`, `biome.json`,
  `ci.yml` con actions fijadas por SHA, el formato de `CHANGELOG.md`, `.editorconfig`,
  `tsconfig.base.json` y `vitest.config.ts`.
- Desde cero: `ROADMAP.md`, `docs/DECISIONES.md`, `docs/ESTADO.md`, `README.md`,
  `.env.example`, `AgentHabitError` + `hasErrorCode` (con sus tests), los stubs de los seis
  paquetes y las tres apps, `foundry.toml` y los contratos vacíos.

**Lo que T1 deja a propósito para T2.** Todo lo que necesita una versión resuelta en vivo:
`soroban-sdk`, la versión de solc, forge-std, OpenZeppelin y el job de Foundry en CI. También los
scripts (`bootstrap.ts`, `deploy-*.ts`, `scripts/lib/`). Los `deployments/*.json` los escribe T7.

**Revisión (`/revisar`).** Sin bloqueantes: cinco importantes y cuatro sugerencias, todas
corregidas en un commit `fix` sobre la misma rama a pedido del usuario. Lo principal: los
permisos dejaban pasar un despliegue o `settle --live` escrito como `pnpm --filter …`, y el
bloqueo de lectura de `.env*` era parcial; ahora ambos preguntan o se niegan. Dos documentos
decían que los tests de Foundry ya corren en CI; ahora dicen que llegan en T2, que además suma
compilar el contrato de Soroban para la red.

**Pendiente para cerrar T1.**
- ~~Merge del PR #1~~: hecho el 15-oct, fast-forward de `main` a `a52bf3c` con la CI en verde
  (`pnpm check` y `cargo test`). `main` nació como un commit raíz vacío (`f74bc38`), la excepción
  a la regla 7 que aprobó el usuario.
- Correr `/estado` de verdad en una sesión abierta en `~/dev/AgentHabit` y anotar su salida en
  la evidencia.
