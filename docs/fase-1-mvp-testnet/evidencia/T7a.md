# Evidencia T7a · Web mínima, solo Stellar

Salidas crudas del 2026-10-17, sobre la rama `cc/t7a-web-stellar` rebasada en `main` (`a4aa29e`). Sin secretos: la web
no guarda claves, los tests usan una wallet simulada y una API de mentira (`apps/web/dev/`).

## Verificación

```
$ pnpm check
Checked 149 files in 104ms. No fixes applied.
 Test Files  34 passed (34)
      Tests  419 passed (419)
```

## Lo que prueba cada archivo

| Archivo | Qué prueba |
|---|---|
| `apps/web/test/flows.test.ts` | Vincular, comprometer y recuperar de punta a punta contra la API simulada; la semana confirmada antes de firmar; el compromiso firmado que no se pierde; la consulta de una transacción `PENDING`; la sesión vencida (401) |
| `apps/web/test/app.test.tsx` | Las pantallas: sin vincular, sin Strava, con compromiso activo, esperando liquidación, semanas anteriores con "Recuperar", y los errores del contrato con el enlace al faucet |
| `apps/web/test/reasons.test.ts` | Que el cliente conserva el `reason` de un rechazo, que cada motivo tiene su mensaje, que uno desconocido cae en el genérico y que el faucet solo aparece con `InsufficientBalance` y `NoUsdcTrustline` |
| `apps/web/test/amounts.test.ts` | Montos en `bigint` con los 7 decimales de Stellar USDC, metas en metros enteros y los límites exactos de monto y meta |
| `apps/web/test/isolation.test.ts` | Que el código de la web no importa la API de mentira, `hono` ni el SDK de Stellar, que no carga nada de un CDN, que no escribe en la consola y que `localStorage` solo lo toca `pending.ts` |
| `apps/web/test/mock-app.test.ts` | Que la API de mentira responde con la forma del contrato en cada escenario, no entrega datos sin sesión ni con un token inventado y solo acepta el origen de la web |
| `apps/web/test/time-csp.test.ts` | Cuándo aparece el botón Recuperar, los días que quedan y que la política CSP permite solo a la web y a la API |
| `apps/web/test/web-units.test.ts` | `VITE_API_URL` (`https:` obligatorio en producción), la lista de destinos permitidos para la redirección de Strava, que un monto nunca se trunca, que el token tenga 7 decimales y las fechas en UTC-3 |

## Lo que no se pudo verificar todavía

- **Freighter real firmando el `commit`** armado por la API: lo prueba el usuario en el ensayo del viernes 23.
- **El cuerpo real de un 422** (`ContractRejected` con `reason`) en un navegador: se comprobó contra el esquema
  compartido (`ErrorResponseSchema`) y contra el mock, no contra la API desplegada.
- **La política CSP en Render:** Render no lee `_headers`; las cabeceras se copian a `render.yaml` (ver
  `PUBLICAR-EN-RENDER.md`).
