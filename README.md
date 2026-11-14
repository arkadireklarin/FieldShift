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
2. Select **Wheat**, choose **No** for irrigation, leave measured soil pH blank, and click **Analyze field**. The loading state should give way to climate history, six crop suitability cards, and three ranked plans with three cycles and explanations each.
3. In **Climate history**, open **View monthly values and daily coverage**. Check the NASA POWER source link, the 2021–2025 period, monthly mean air temperature in °C, monthly precipitation totals in mm, and the day counts. Check the rotation notes for the missing-pH explanation.
4. Within five minutes, click **Analyze field** again with the same inputs. The results should stay the same and the browser Network panel should show no new analysis request. Switch irrigation to **Yes** and analyze, then switch the previous crop to **Chickpea** and analyze. Compare the score factors and transition explanations. Each changed analysis sends one `POST /api/recommend`.
5. Repeat the flow in a narrow mobile viewport. Check that the field inputs, charts, monthly table, and plan cards are usable without horizontal page scrolling.
6. For the invalid-input check, request `/api/climate?lat=&lon=32.775` or `/api/climate?lat=91&lon=32.775`. Both should return `400 INVALID_INPUT`. The map limits point selection to valid coordinates.
7. For an outage check, run `npm test -- src/app/api/routes.test.ts -t "typed climate errors"` to simulate upstream failures. The expected cold-cache response is `503 CLIMATE_UNAVAILABLE`. In the dashboard, the error clears the loading state and allows retry. During an upstream outage the dashboard can display historical values from a genuine cached response for the selected point and period.

## Deploy to Vercel

1. Push the project to a Git repository connected to Vercel, including `package-lock.json`. In Vercel, choose **Add New → Project** and import the repository. [Vercel Git deployment](https://vercel.com/docs/git)
2. Use the **Next.js** framework preset, the directory containing `package.json` as the root, and **Node.js 24.x**. Keep the default Next.js build and output settings so Vercel serves the API routes. FieldShift requires zero environment variables or API keys. [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) · [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
3. Deploy and run steps 1–5 on the deployment URL. Check that `POST /api/recommend` returns HTTP 200 for the Konya field before using the deployment for a demo.

## Model and data limits

- The climate charts describe historical NASA POWER grid-cell estimates. A drawn boundary records the shape of the field. The selected point determines the climate query.
- The model uses six provisional Central Anatolia crop profiles. Scores compare relative fit and use irrigation availability as a binary input. Three plans require at least three distinct crops that meet the seasonal criteria. Plan timing advances with the Istanbul calendar month.
- The server cache is process-local. Cold starts and different instances can require a fresh NASA POWER retrieval. If NASA POWER fails and no matching history is cached, analysis is unavailable until a retry succeeds.

See the [architecture and API contract](docs/architecture.md) and the [two-day task breakdown](docs/task-breakdown.md).
