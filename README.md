# FieldShift

Team Nautilus · NASA Space Apps Challenge 2026

FieldShift uses historical NASA POWER climate data, the previous crop, and irrigation availability to rank crop suitability and three-cycle rotation plans.

## Local development

Use Node.js 24 and npm. With nvm, run `nvm use` to select the version in `.nvmrc`.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000).

```sh
npm run typecheck
npm test
npm run build
npm run start
```

Stop the development server before starting the production server on the same port.

## Demo checklist

1. Open the dashboard and click **Select map center** to select the default field near Çumra, Konya (37.5667° N, 32.7750° E).
2. Select **Wheat**, choose **No** for irrigation, and leave measured soil pH blank. Turn on **Compare with my current rotation** and enter **Wheat**, **Fallow**, **Wheat** as an example. Click **Analyze field**. In **Rotation plans**, compare the current plan with the three alternatives by calendar, months without a primary crop, and crop and family counts.
3. In **Climate history**, open **View monthly values and daily coverage**. Check the NASA POWER source link, the 2021–2025 period, monthly mean air temperature in °C, monthly precipitation totals in mm, and the day counts. Check the rotation notes for the missing-pH explanation.
4. Within five minutes, click **Analyze field** again with the same inputs. The results should stay the same and the browser Network panel should show no new analysis request. Switch irrigation to **Yes** and analyze, then switch the previous crop to **Chickpea** and analyze. Compare the score factors and transition explanations. Each changed analysis sends one `POST /api/recommend`.
5. Repeat the flow in a narrow mobile viewport. Check that the field inputs, charts, monthly table, and plan cards are usable without horizontal page scrolling.
6. For the invalid-input check, request `/api/climate?lat=&lon=32.775` or `/api/climate?lat=91&lon=32.775`. Both should return `400 INVALID_INPUT`. The map limits point selection to valid coordinates.
7. For an outage check, run `npm test -- src/app/api/routes.test.ts -t "typed climate errors"` to simulate upstream failures. The expected cold-cache response is `503 CLIMATE_UNAVAILABLE`. In the dashboard, the error clears the loading state and allows retry. During an upstream outage the dashboard can display historical values from a genuine cached response for the selected point and period.

To demonstrate different decisions from the same climate data, use the Çumra point with **Chickpea** as the previous crop, **Yes** for irrigation, and no measured pH. In **Rotation plans**, compare the first harvest, crop families, and model score across the three priorities. The same sequence can lead on more than one priority, and the planting dates advance with the planning month.

For the same Çumra example with a December 2026 planning start, set **July 2027** as the latest first harvest. Set the seasonal irrigation quota to **340 m³/da**, then try **310** and **300**. Compare which sequences survive the quota in both climate runs. Next, hold all other Çumra inputs fixed at **340 m³/da** and change a single local soil input — for example, set **Effective root-zone depth** to **50 cm** (a shallow caliche barrier capping preseason soil water storage at 65 mm instead of 130 mm) or set **Soil texture class** to **Coarse (90 mm/m)**. In **Local soil, field parcel & NASA POWER decision chain**, review which crop water balances, quota matches, and top rotation plans changed and which FAO-56 assumption caused the shift. Expand **Published field evidence** to see the reported trial outcomes and model checks. The [Turkish jury demo](docs/jury-demo.md) records the reference run and its limits.

## Deploy to Vercel

1. Push the project to a Git repository connected to Vercel, including `package-lock.json`. In Vercel, choose **Add New → Project** and import the repository. [Vercel Git deployment](https://vercel.com/docs/git)
2. Use the **Next.js** framework preset, the directory containing `package.json` as the root, and **Node.js 24.x**. Keep the default Next.js build and output settings so Vercel serves the API routes. FieldShift requires zero environment variables or API keys. [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) · [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
3. Deploy and run steps 1–5 on the deployment URL. Check that `POST /api/recommend` returns HTTP 200 for the Konya field before using the deployment for a demo.

## What a grower sees

The workspace opens in Turkish with an **English** switch. The result is one card: the single change to make, the sequence before and after, why the model ranks it first, what to watch, and a line saying the decision stays with the grower and their agronomist. Everything else — climate charts, crop scores, plan rankings, irrigation quota, dry-year replay, field evidence and the budget — sits behind **Hesabı ve kaynakları göster** and stays in English for review.

**Tek Değişiklik (single change).** When a grower enters their own three cycles, the model replaces each cycle, one at a time, with every other crop and with fallow — 18 candidates — and ranks the results by 1) cycles holding a crop it will not grow on this field, 2) planted transitions that repeat the preceding crop or its family, 3) the largest modeled irrigation of any one season, and 4) months without a primary crop. Step 3 is weighed only on an irrigated field, where the grower pays for the water. Each step is decided before the next is read. Nothing about yield or income is implied: the gains are stated in those four measures alone.

## Model and data limits

- The climate charts describe historical NASA POWER 0.5° × 0.625° grid-cell estimates. The selected point determines which NASA POWER grid cell is queried for daily temperature (`T2M`) and precipitation (`PRECTOTCORR`). A drawn parcel boundary measures field area in decares (`da`) to scale per-decare irrigation quotas (`m³/da`) and gross margins (`TL/da`) to whole-field totals, while optional local soil inputs differentiate fields inside the same climate grid cell.
- Local soil texture (`coarse` 90 mm/m, `medium` 130 mm/m, `fine` 170 mm/m from FAO-56 table 19) and effective root-zone depth (`20–200 cm`, bounded by each crop's FAO-56 table 22 maximum rooting depth) determine the preseason soil water storage cap. When left blank, the model uses the 130 mm Konya trial cap and surfaces the assumption. Measured soil pH is compared against FAO EcoCrop bands when supplied and omitted when blank.
- The soil-health table compares botanical family repetitions, exact crop repetitions, and months without a primary crop between the current rotation and recommended alternatives. Calendar outputs alone do not establish ground cover, soil organic matter (SOM) accumulation, or residual nitrogen; those claims require on-field ground-cover observation, multi-year repeat soil organic matter lab sampling at matching depth and season, and pre-sowing mineral nitrogen testing.
- The model uses six provisional Central Anatolia crop profiles inside an approximate pilot boundary. Points outside the pilot still receive NASA POWER climate history. Rotation plans require at least three distinct crops with sufficient active-season temperature and water data. A provisional rainfed yield-share screen excludes severe modeled water deficits from rainfed plans.
- A seasonal irrigation quota in m³/da applies to net water delivered to the root zone in each crop cycle. The model checks the largest estimated season in each of the available climate runs. The water balance compares the crop profile’s full seasonal demand with in-season rainfall and estimated carryover storage. It uses a simplified rainfall proxy and excludes delivery losses. [FAO irrigation water needs](https://www.fao.org/4/s2022e/s2022e08.htm)
- The calendar-only benchmark uses the same crop catalog and start month. It selects the fastest first harvest and then fastest finish before checking climate and water. The comparison evaluates calendar, model score and modeled irrigation separately.
- The three decision priorities search all modeled candidate sequences. The highest-score plan uses the weighted suitability, transition, and diversity model. The early-harvest plan prioritizes the first harvest month. The diversity plan maximizes the number of botanical crop families. These reflect the assumed calendars and crop profiles.
- The dry-year replay repeats monthly temperatures and rainfall from the lowest-rainfall complete calendar year when its total falls below the median of the complete years. The lower of the historical and replay scores is each sequence’s floor. The model highlights the sequence with the highest floor among candidates eligible in both runs. The replay measures model sensitivity to one past pattern. It does not establish future weather, expected yield, or water savings.
- The optional comparison projects the grower's next three planned cycles using the same start month and regional calendar as the recommendations. Each plan ends after its third cycle, so durations can differ. A fallow cycle occupies 12 months from the first available month. Months without a primary crop also include gaps between crop cycles and can have ground cover. The comparison describes the projected schedule and crop diversity.
- The server cache is process-local. Cold starts and different instances can require a fresh NASA POWER retrieval. If NASA POWER fails and no matching history is cached, analysis is unavailable until a retry succeeds.

For the hackathon: [submission materials and demo](docs/submission.md) in English, and the [Turkish jury walkthrough](docs/jury-demo.md).

See the [architecture and API contract](docs/architecture.md) and the [two-day task breakdown](docs/task-breakdown.md).

The [Turkish validity evidence](docs/validity-evidence.md) covers the water constraint, the comparison with published field trials, the grower budget under **Costs and returns**, and operating costs.

For a facilitated decision pilot, enable **Record a pilot session** inside the current-rotation form. Enter a study code and intention before analysis, then record the choice and download the CSV under **Pilot decision feedback**. The [Turkish pilot guide](docs/impact-pilot.md) defines decision and field outcomes.
