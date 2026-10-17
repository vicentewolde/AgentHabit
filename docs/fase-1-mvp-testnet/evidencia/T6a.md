# Evidencia T6a · Contratos vivos en Stellar

Salidas crudas del 2026-10-17, rama `cc/t6a-stellar-produccion` desde `origin/main` (`9492087`). Sin secretos: todos los
tests usan claves sintéticas y una red simulada. **Todavía no hay un despliegue real:** esa evidencia se agrega aquí
cuando el usuario dé el OK y el contrato esté en la red.

## Verificación

Después de `/revisar` (commits `fix`). Antes de la revisión eran 291 tests.

```
$ pnpm check
Checked 103 files in 46ms. No fixes applied.
 Test Files  26 passed (26)
      Tests  318 passed (318)

$ pnpm exec vitest run (archivos de T6a)
 Test Files  11 passed (11)
      Tests  144 passed (144)
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

## Revisión (`/revisar`)

El `revisor` no encontró bloqueantes ni ningún camino para sacar fondos hacia alguien que no sea el dueño. Marcó seis
importantes y varias sugerencias. Corregidos, cada uno con su test:

| Hallazgo | Corrección |
|---|---|
| Un commit que la web no informó dejaba de verse en "recuperar" tras una semana | `/weeks/me` mira las 12 semanas anteriores y las informadas, las consulta juntas y filtra por `Active` antes de limitar |
| La API no contrastaba `deployments/*.json` con el contrato | `verify()` compara token, oráculo, ancla y límites con `config()`; la API no arranca si difieren |
| El comando para enviar el despliegue estaba mal documentado | `pnpm run deploy:stellar --yes`; el README trae también `--reset` |
| La caché de Strava podía mostrar datos de más de 7 días y la purga no corría | Se ignora una lectura vencida y el servidor purga al arrancar y cada hora |
| Un número fuera de rango terminaba como un 500 | El contrato acota `weekId` (u64) y `amount` (i128) antes de llegar al SDK |
| `/tx/submit` no exigía Strava vivo para un `commit` | Lo exige, y un `release_if_stale` siempre pasa |
| Sugerencias: operación con otro origen, argumentos raros, `getAccount` caído, `WEB_ORIGIN` con `/`, plan sin fechas, id de un contrato huérfano | Todas corregidas |

Quedaron como deuda, anotadas: manejar un contrato vencido por inactividad (`restorePreamble`) y un límite de pedidos.
