# Hackatón Vinny · ficha de entrega

> **Supuestos.** El usuario dio solo el nombre de la hackatón (16-oct-2026). El plazo y los requisitos
> de abajo son **supuestos de trabajo**, armados con lo típico de una hackatón de Avalanche. Si aparecen
> las bases oficiales, se reemplazan aquí y se vuelve a revisar la tabla.

**Hackatón:** Vinny (ecosistema Avalanche).
**Repo que se entrega:** [vicentewolde/AgentHabit](https://github.com/vicentewolde/AgentHabit), el mismo del
proyecto. No hay copia aparte.
**Plazo supuesto:** domingo **15-nov-2026, 23:59 (UTC-3)**.

## Requisitos supuestos y cómo estamos

| # | Requisito | Estado | Qué falta |
|---|---|---|---|
| 1 | Repo público en GitHub con licencia open source | ✅ | Apache-2.0 en [LICENSE](../LICENSE) |
| 2 | README con el problema, la solución, el uso de Avalanche y cómo correrlo | ✅ | Hecho en el PR #9 |
| 3 | Código hecho durante la hackatón, con historial visible | ✅ | El primer commit es del 15-oct-2026 |
| 4 | Al menos un contrato desplegado en Avalanche Fuji, con su dirección en el README | ⏳ | El contrato EVM es de T4 y el despliegue en Fuji es parte de T6 |
| 5 | Contrato verificado en el explorador de Fuji (Snowtrace) | ⏳ | No está en el spec de la Fase 1: hay que agregarlo si se quiere |
| 6 | Video de demo de 3 minutos como máximo | ⏳ | Necesita al menos el `commit` en Fuji para mostrar algo real |
| 7 | Descripción corta (una línea) y categoría | ✅ | La descripción del repo en GitHub sirve: "Put money on your running goal…" |

## Lo mínimo para llegar al plazo

Con los requisitos supuestos, lo que de verdad falta es un contrato vivo en Fuji y un video. Dentro del spec
aprobado eso es:

1. **T4 · Núcleo y contratos.** Deja el contrato EVM con sus tests, pasando la tabla de casos.
2. **El despliegue en Fuji de T6** (`pnpm run deploy:avalanche`), con el OK del usuario y con AVAX de prueba en
   las direcciones de Fuji (pendiente del usuario en [ESTADO.md](ESTADO.md)).
3. **El video,** grabado sobre ese contrato: `approve` + `commit` desde una wallet en Fuji y la posición en
   Snowtrace.

La liquidación, Strava y la web (T5, T7 y T8) no hacen falta para la entrega. Suman al video si llegan a tiempo.

## Propuestas que necesitan el OK del usuario

No se aplican hasta que el usuario las apruebe (`CLAUDE.md`, método de trabajo):

- **Adelantar el despliegue en Fuji** antes del resto de T6, o partir T6 en despliegue y liquidación.
- **Agregar al spec la verificación del contrato en Snowtrace** (requisito 5).
- **Guion del video,** cuando el contrato esté en Fuji.
