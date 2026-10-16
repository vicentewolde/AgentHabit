# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Una versión por
fase (ver `ROADMAP.md`): Fase 0 `v0.0.1`, Fase 1 `v0.1.0`, Fase 2 `v0.2.0`, Fase 3 `v0.3.0`.
Cada tag se crea solo con permiso del usuario.

## [Sin publicar]

### Cambiado
- **README para la hackatón de Avalanche:** el README explica el problema, cómo funciona el
  compromiso (con un diagrama), por qué Avalanche, la arquitectura y el avance real del proyecto.
- **Ficha de la hackatón Vinny:** qué pide la entrega (con plazo y requisitos supuestos), qué está
  listo y qué falta.

## [0.0.1] - 2026-10-16

Fase 0 · Fundamentos. AgentHabit ya tiene su casa y su forma de trabajar:
- un repo público con la estructura de la app y de los dos contratos;
- las herramientas instaladas y fijadas, para que tu Mac y la CI compilen lo mismo;
- las claves de prueba de Stellar y Avalanche, creadas sin mostrarse nunca;
- el plan de la Fase 1 aprobado, que ya incorpora los términos de Strava.

Todavía no hay una app que usar: los contratos están vacíos y la Fase 1 los llena.

### Añadido
- **El repo y su método (T1):** la estructura del monorepo (web, API, liquidador, dominio común,
  un adaptador por cadena, los contratos de Stellar y Avalanche), vacía pero compilando;
  `pnpm check` (Biome, tipos y tests); CI con actions fijadas por SHA; las skills `/estado`,
  `/tarea`, `/revisar`, `/fase-plan` y `/fase-cerrar`; los subagentes `revisor`, `arquitecto` e
  `integraciones`; los permisos del proyecto; y los registros (`ROADMAP.md`, `docs/ESTADO.md`,
  `docs/DECISIONES.md` con P-1 a P-7).
- **Herramientas y claves de testnet (T2):** `pnpm run bootstrap` crea las claves de deployer,
  oráculo y usuario de prueba de Stellar y Avalanche en `.env.local`, sin mostrarlas nunca, y se
  puede repetir sin pisar nada. Fondea las cuentas de Stellar testnet con Friendbot, crea la
  trustline de USDC del usuario de prueba e imprime las direcciones de Fuji para los faucets. Los
  contratos vacíos de las dos cadenas compilan y se prueban en local y en CI
  (`pnpm run contracts:build:stellar`, `forge test`), con versiones fijadas.
- **El plan de la Fase 1 (T3):** [`docs/fase-1-mvp-testnet/SPEC.md`](docs/fase-1-mvp-testnet/SPEC.md),
  aprobado: 14 tareas para un compromiso completo en Stellar testnet y en Fuji.
