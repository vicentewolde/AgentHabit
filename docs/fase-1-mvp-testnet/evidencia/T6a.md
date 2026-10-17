# Evidencia T6a · Contratos vivos en Stellar

Salidas crudas del 2026-10-17, rama `cc/t6a-stellar-produccion` desde `origin/main` (`9492087`). Sin secretos: todos los
tests usan claves sintéticas y una red simulada. **Todavía no hay un despliegue real:** esa evidencia se agrega aquí
cuando el usuario dé el OK y el contrato esté en la red.

## Verificación

```
$ pnpm check
Checked 102 files in 82ms. No fixes applied.
 Test Files  25 passed (25)
      Tests  291 passed (291)

$ pnpm exec vitest run (archivos de T6a)
 Test Files  8 passed (8)
      Tests  106 passed (106)
```

## Lo que prueba cada archivo

| Archivo | Qué prueba |
|---|---|
| `packages/chain-stellar/test/contract-client.test.ts` | Decodificar una llamada; leer config, semana y posición; armar `commit` y `release_if_stale`; **la regla del reenvío** (otro contrato, otra función, otra wallet, la posición de otro y dos operaciones no se envían); verificar un `commit` por su hash |
| `scripts/lib/deploy-stellar.test.ts` | Primer despliegue, repetición sin efecto, ancla conservada, desvío, wasm distinto y reinicio de testnet con `--reset` |
| `scripts/lib/deploy-stellar-cli.test.ts` | Sin `--yes` no envía nada, ninguna clave llega a la salida, claves o wasm ausentes, opción desconocida, y que el id del USDC de testnet coincide con el verificado el 16-oct |
| `apps/api/test/app.test.ts` | Los endpoints nuevos validados contra los esquemas compartidos: `/config`, `/me`, `/weeks/me`, `/tx/*`, la caché de Strava, lo que ve cada wallet y CORS |
| `packages/core/src/deployments.test.ts` | El formato de `deployments/*.json` y el ancla de lunes a las 00:00 en UTC-3 |

## Lo que no se pudo verificar todavía

- **La forma real de lo que devuelve el contrato desplegado** (`config`, `get_position`): los tests la simulan con la
  forma que `soroban-sdk` documenta. Se confirma con el primer despliegue.
- **Que Freighter firme el `commit` armado por la API.** Lo prueba el usuario en el ensayo del viernes 23.
