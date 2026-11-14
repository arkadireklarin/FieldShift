# FieldShift architecture

FieldShift uses one Next.js App Router application. A browser picks a field near Çumra, Konya, and enters the previous crop and irrigation availability. Next.js Route Handlers validate inputs and call server-side climate and recommendation functions. Vercel can build and serve the app with the standard Next.js preset.

| Location | Responsibility |
| --- | --- |
| `src/app/` | Landing page, field workflow entry point, and HTTP route handlers |
| `src/components/` | Client-side React Leaflet map and polygon editor, field form, Recharts climate charts, recommendation display, and the grower budget |
| `src/lib/nasa/` | NASA POWER client, response validation, daily-to-monthly aggregation, and provenance |
| `src/lib/crops/` | Profile loading, the seasonal water balance, and suitability scoring with explanations |
| `src/lib/regions/` | Approximate pilot boundary that decides where scores and plans are returned |
| `src/lib/validation/` | Comparison of the current model with published field trial outcomes |
| `src/lib/rotation/` | Three-cycle sequence scoring and deterministic ranking |
| `src/data/` | Referenced provisional crop profiles in local JSON and a genuine NASA POWER retrieval for Konya used by the field evidence checks |
| `src/types/api.ts` | Shared request, response, and domain types |
| `docs/` | Architecture, evidence rules, and team handoff |

## Shared contract

| Type | What callers exchange |
| --- | --- |
| `FieldSelection` | Required latitude/longitude, previous crop, and irrigation availability. Optional polygon, measured pH, soil texture (`coarse`, `medium`, `fine`), effective root-zone depth (`20–200 cm`), three-cycle `currentRotation`, latest first-harvest month, and seasonal net irrigation quota. |
| `ClimateSummary` | Monthly mean air temperature in °C and total precipitation in mm, plus expected and valid day counts per metric. Null means insufficient coverage. |
| `RecommendResponse` | The `ClimateSummary` used for scoring, regional `applicability`, `spatialContext` (NASA grid cell and drawn parcel area/role), `soilAssessment` (local soil inputs, NASA decision chain, baseline comparison, and single-input sensitivity checks), `soilHealth` (family repetition, uncropped duration, and required field evidence), crop suitability, ranked rotations, decision priorities, `modelEvidence`, and their provenance and limitations. Includes `rotationComparison` when the user provides a current rotation. |
| `CropProfile` | One of six crop IDs, display name, family, provisional validation status, and references. Developer B can add referenced scoring inputs when the model is agreed. |
| `CropSuitability` | Per-crop 0–100 heuristic score or null, a `feasibility` status with reasons, the seasonal `water` balance, signed factors with explanations, and limitations. Only feasible crops enter rotations. |
| `RotationRecommendation` | Exactly three ordered future primary crops, a 0–100 heuristic score, explanations, and limitations. |
| `DataProvenance` | Discriminated union for NASA POWER retrievals, genuine cached NASA POWER retrievals, unavailable data, and assumptions. NASA variants identify the source request, period, parameters, and grid-cell scope. |

- `GET /api/climate?lat=...&lon=...` returns a `ClimateSummary` on success. Validate finite numeric coordinates in latitude ±90 and longitude ±180. Return `400 INVALID_INPUT` for bad input and `503 CLIMATE_UNAVAILABLE` when usable climate data is unavailable.
- `POST /api/recommend` takes a `FieldSelection` JSON body. It validates the input and returns the climate snapshot used for scoring, six suitability results, and up to three distinct ranked rotations. It uses the same error shape and codes as the climate route. The dashboard makes one request to this route per new analysis so the charts and recommendations use the same snapshot.
- `rotationStrategies` contains the strongest schedule by model score, earliest first harvest, and greatest crop family count across all candidate sequences. A schedule shared by several priorities appears once with all its priority IDs. The score-ranked `rotations` and optional `rotationComparison` retain their order.
- The optional `latestFirstHarvest` request month (`YYYY-MM`) filters candidates by their first modeled harvest, including the selected month. `harvestDeadline` reports filtered and unfiltered counts and the earliest month among unfiltered candidates. The user-provided current calendar can still be shown even if it would miss the deadline.
- `rotationStressTest` reruns the same candidate rules and deadline on repeated monthly temperatures and rainfall from the lowest-rainfall complete calendar year. The historic climate response remains the original series. Ranks are by model score with tied scores sharing a rank. The scenario pick maximizes the lower model score across both runs, with historical score and then crop ID order breaking ties.
- `irrigationQuotaM3PerDa` accepts zero or more only when irrigation is available. The engine compares the largest modeled crop-season net irrigation estimate in each climate run with the same quota. When both runs are available, the candidate must pass both. `calendarBenchmark` scores and estimates water for the calendar-only choice and the highest-scoring eligible plan. Out-of-area locations return climate history with applicability and empty recommendations.

## Scientific decisions

- The demo window is 2021–2025, five complete calendar years. The NASA POWER request uses daily `T2M`, `T2M_MAX`, `T2M_MIN`, and `PRECTOTCORR`, the agricultural community, and UTC. The response records the request URL and retrieval time. NASA POWER meteorology is gridded historical data, including reanalysis. The selected point determines the grid cell for the climate query. [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) · [NASA POWER data processing](https://power.larc.nasa.gov/docs/methodology/data/processing/)
- Filter the provider's fill value and account for missing days per metric. For the MVP, publish each monthly aggregate only when that metric has complete daily coverage. Preserve true zero rainfall and show gaps in charts. If a request fails, return a typed unavailable error unless a genuine historical cache is available for the requested location and period. Label cached results with both retrieval and cache timestamps.
- Three rules gate a crop before ranking. Temperature and rainfall each need at least half of their expected seasons complete, or the crop is unscored. A crop whose active-season months all fall beyond its temperature tolerance is excluded. On a rainfed field, a crop is excluded when its modeled yield share is below 40% of the water-unlimited yield. The yield share follows the FAO-33 response to the shortfall between the crop's full seasonal water use and in-season rain plus soil water carried over from the months before planting. The [validity evidence](validity-evidence.md) lists the parameters, their sources, and the comparison with published trials.
- Validate crop profile sources and units with Member C. Record assumptions and explain how climate, irrigation, and the last crop affect scores. Report unknown pH and omit its scoring factor. Treat rotations as heuristic rankings. Precise yield and water-savings estimates are outside the MVP. Any later NDVI display should describe vegetation greenness with its scope and limitations.
