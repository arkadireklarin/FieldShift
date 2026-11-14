# Two-day handoff

Start with the [shared contract and architecture](architecture.md). Developer A owns the client workflow and Developer B owns route implementation and domain logic. Review changes to `src/types/api.ts` together before wiring the demo.

## Day 1

- **Developer A** builds the field picker centered near Çumra, optional click-to-add polygon vertices with clear/reset, and the previous-crop and irrigation form. Load Leaflet on the client, include map tile attribution, and keep point selection usable without a polygon. Add loading, unavailable, and placeholder states using the shared API types.
- **Developer B** implements the NASA POWER adapter, daily validation, monthly aggregation, and `GET /api/climate`. Test fill values, zero rain, leap days, unavailable responses, and a real historical request near Çumra. Coordinate response fields with Developer A.
- **Member C** finds citeable crop references for all six crops and reviews assumptions about crop families, growing seasons, and irrigation. Prepare the evidence and limitation text alongside a demo checklist.

## Day 2

- **Developer B** adds the six provisional crop profiles and explainable suitability and rotation scoring. Implement `POST /api/recommend`. Test deterministic ranking, the previous-crop effect, three-cycle output, and handling of unknown pH and unavailable climate.
- **Developer A** integrates both routes, charts actual historical trends and missing months, and displays scores, factors, rotations, and provenance. Deploy to Vercel with Node.js 24 and verify the deployed happy path.
- **Member C** runs the demo checklist on desktop and mobile, checks the default field and both irrigation choices, verifies cached or unavailable labeling as applicable, and rehearses the presentation.

A complete demo starts with a field, a previous crop, and irrigation availability. It shows historical climate and provenance, six crop suitability outcomes, and up to three distinct explained plans with three future primary crops each. It also shows a clear state when NASA POWER is unavailable.
