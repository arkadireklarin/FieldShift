# FieldShift architecture

FieldShift uses one Next.js App Router application. A browser picks a field near Çumra, Konya, and enters the previous crop and irrigation availability. Next.js Route Handlers validate inputs and call server-side climate and recommendation functions. Vercel can build and serve the app with the standard Next.js preset.

| Location | Responsibility |
| --- | --- |
| `src/app/` | Landing page, field workflow entry point, and HTTP route handlers |
| `src/components/` | Client-side React Leaflet map and polygon editor, field form, Recharts climate charts, and recommendation display |
| `src/lib/nasa/` | NASA POWER client, response validation, daily-to-monthly aggregation, and provenance |
| `src/lib/crops/` | Profile loading and suitability scoring with explanations |
| `src/lib/rotation/` | Three-cycle sequence scoring and deterministic ranking |
| `src/data/` | Referenced provisional crop profiles in local JSON and any genuine cache explicitly added later |
| `src/types/api.ts` | Shared request, response, and domain types |
| `docs/` | Architecture, evidence rules, and team handoff |

## Shared contract

| Type | What callers exchange |
| --- | --- |
| `FieldSelection` | Required latitude/longitude, previous crop, and irrigation availability. An optional polygon describes the field boundary. Omit pH unless measured. |
| `ClimateSummary` | Monthly mean air temperature in °C and total precipitation in mm, plus expected and valid day counts per metric. Null means insufficient coverage. |
| `RecommendResponse` | The `ClimateSummary` used for scoring, crop suitability, ranked rotations, and their provenance and limitations. |
| `CropProfile` | One of six crop IDs, display name, family, provisional validation status, and references. Developer B can add referenced scoring inputs when the model is agreed. |
| `CropSuitability` | Per-crop 0–100 heuristic score or null, signed factors with explanations, and limitations. |
| `RotationRecommendation` | Exactly three ordered future primary crops, a 0–100 heuristic score, explanations, and limitations. |
| `DataProvenance` | Discriminated union for NASA POWER retrievals, genuine cached NASA POWER retrievals, unavailable data, and assumptions. NASA variants identify the source request, period, parameters, and grid-cell scope. |

- `GET /api/climate?lat=...&lon=...` returns a `ClimateSummary` on success. Validate finite numeric coordinates in latitude ±90 and longitude ±180. Return `400 INVALID_INPUT` for bad input and `503 CLIMATE_UNAVAILABLE` when usable climate data is unavailable.
- `POST /api/recommend` takes a `FieldSelection` JSON body. It validates the input and returns the climate snapshot used for scoring, six suitability results, and up to three distinct ranked rotations. It uses the same error shape and codes as the climate route. The dashboard makes one request to this route per new analysis so the charts and recommendations use the same snapshot.

## Scientific decisions

- The demo window is 2021–2025, five complete calendar years. The NASA POWER request uses daily `T2M`, `T2M_MAX`, `T2M_MIN`, and `PRECTOTCORR`, the agricultural community, and UTC. The response records the request URL and retrieval time. NASA POWER meteorology is gridded historical data, including reanalysis. The selected point determines the grid cell for the climate query. [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) · [NASA POWER data processing](https://power.larc.nasa.gov/docs/methodology/data/processing/)
- Filter the provider's fill value and account for missing days per metric. For the MVP, publish each monthly aggregate only when that metric has complete daily coverage. Preserve true zero rainfall and show gaps in charts. If a request fails, return a typed unavailable error unless a genuine historical cache is available for the requested location and period. Label cached results with both retrieval and cache timestamps.
- Validate crop profile sources and units with Member C. Record assumptions and explain how climate, irrigation, and the last crop affect scores. Report unknown pH and omit its scoring factor. Treat rotations as heuristic rankings. Precise yield and water-savings estimates are outside the MVP. Any later NDVI display should describe vegetation greenness with its scope and limitations.
