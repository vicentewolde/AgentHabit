# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Una versión por
fase (ver `ROADMAP.md`): Fase 0 `v0.0.1`, Fase 1 `v0.1.0`, Fase 2 `v0.2.0`, Fase 3 `v0.3.0`.
Cada tag se crea solo con permiso del usuario.

## [Sin publicar]

### Añadido
- **La web en español, solo Stellar (T7a):** el usuario vincula su wallet Freighter, conecta Strava, compromete entre
  20 y 50 USDC con su meta semanal, ve el estado de su semana y recupera el depósito si el oráculo no liquidó a tiempo.
  Si el contrato rechaza una operación, dice por qué (por ejemplo, falta USDC de prueba) y enlaza al faucet de Circle.
  Un compromiso firmado no se pierde si se cae la red. Probada con una wallet simulada; Freighter real, en el ensayo.
- **Contratos vivos en Stellar (T6a):** el contrato de producción está desplegado en Stellar testnet, con el comando
  para desplegarlo, la conexión con el contrato y la API de la web (estado de la semana, comprometer y recuperar).
  `pnpm run smoke:stellar` comprueba el contrato real sin enviar nada. Cuando el contrato rechaza una operación, la API
  dice por qué: no hay suficiente USDC, falta la línea de confianza de USDC, la meta está fuera de rango, etc.
- **Strava y la API (T5):** la API vincula una wallet de Stellar o Avalanche con una cuenta de Strava mediante un
  mensaje firmado, conecta Strava pidiendo ver todas las carreras y guarda los tokens cifrados. Cuenta los km de la
  semana solo con carreras válidas y registra una posición solo después de leerla en la cadena. Los datos de Strava se
  borran a los 7 días. Probado con un Strava simulado; la prueba con la cuenta real queda pendiente.
- **Los dos contratos (T4):** el de Avalanche (Solidity) y el de Stellar (Soroban) guardan el depósito, lo devuelven
  si se cumple la meta, lo dejan bloqueado si no, y permiten que cualquiera lo devuelva a su dueño si el oráculo no
  liquidó a tiempo. Los dos pasan la misma tabla de 45 casos, escrita una sola vez en el núcleo común. Todavía no
  están desplegados.

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
