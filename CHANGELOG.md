# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Una versión por
fase (ver `ROADMAP.md`): Fase 0 `v0.0.1`, Fase 1 `v0.1.0`, Fase 2 `v0.2.0`, Fase 3 `v0.3.0`.
Cada tag se crea solo con permiso del usuario.

## [Sin publicar]

### Añadido
- **El repo y su método (T1):** la estructura del monorepo (web, API, liquidador, dominio común,
  un adaptador por cadena, los contratos de Stellar y Avalanche), vacía pero compilando;
  `pnpm check` (Biome, tipos y tests); CI con actions fijadas por SHA; las skills `/estado`,
  `/tarea`, `/revisar`, `/fase-plan` y `/fase-cerrar`; los subagentes `revisor`, `arquitecto` e
  `integraciones`; los permisos del proyecto; y los registros (`ROADMAP.md`, `docs/ESTADO.md`,
  `docs/DECISIONES.md` con P-1 a P-7).
