# FieldShift — submission materials

Everything on this page is English, as the [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/) requires for the submission page and any linked material. The demo must be either a **7-slide deck** (title and intro slides included) or a **30-second video**. A video may be spoken in Turkish with English subtitles.

**Take the deck.** Thirty seconds holds about seventy spoken words, which is one sentence per idea and no room to show the product working.

Every figure below comes from one live run: Çumra (37.5667° N, 32.7750° E), last crop wheat, no irrigation, current plan wheat → fallow → wheat.

---

## Demo A — 7 slides (recommended)

### 1 · Title

> **FieldShift**
> One change to your crop rotation, from NASA's climate record.
> Team Nautilus · NASA Space Apps Ankara 2026 · Field Shift: Adapting Farms with NASA Data

### 2 · The problem

> In the Konya basin a common rotation is wheat, fallow, wheat.
> Groundwater is falling and the growing season is shifting.
> Tools that answer this either show satellite pictures of the field or ask the farmer to start a whole new plan from scratch.
> A farmer with one tractor, one seed drill and one buyer does not start from scratch.

### 3 · What the farmer does

> Two questions: **your last crop**, and **can you irrigate?**
> Optionally: your own next three crops, your soil, your water quota.
> Nothing the farmer cannot answer from memory.
> *Screenshot: the Turkish form, 39 words on the first screen.*

### 4 · The answer

> **"Change one thing in your plan: chickpea instead of wheat in cycle 1."**
> Before: wheat → fallow → wheat · After: chickpea → fallow → wheat
> It breaks 2 back-to-back repetitions and leaves the field bare 8 months less.
> *Screenshot: the recommendation card, before-and-after strips.*

### 5 · What is behind it

> The model ranked all 18 one-cycle changes by, in this order:
> 1. crops it will not grow on this field — sunflower and maize reach 33% and 18% of their water-unlimited yield without irrigation, under a 40% cutoff
> 2. transitions that repeat the preceding crop or its family
> 3. the largest irrigation any one season needs — weighed only when the field is irrigated
> 4. months without a crop
>
> Five years of daily NASA POWER temperature and rainfall, 2021–2025, drive steps 1 and 3 through an FAO-33 water balance.

### 6 · Why believe it

> The model is checked against **11 published field-trial outcomes on every request. All 11 agree.**
> Five come from trials that set none of its parameters — including rainfed wheat in Ankara over four seasons: the trial says 60% of the irrigated yield, the model says 56%.
> A dry-year replay reruns the same rules on 2025, the driest complete year on record for this cell: 347 mm against a 528 mm median.

### 7 · What we do not claim

> No yield or income forecast. The gains are stated only in the four measures above.
> NASA POWER is a grid-cell estimate, not a measurement on the field.
> No farmer has tested this yet. The pilot protocol and the recording tool are built and waiting.
> **The decision stays with the farmer and their agronomist.**

---

## Demo B — 30-second video script

68 words, about 27 seconds at a normal pace. Record the screen while speaking.

> In Konya, a farmer plants wheat, fallow, wheat.
> FieldShift asks two things: your last crop, and can you irrigate.
> It reads five years of daily NASA POWER weather for that field
> and suggests one change: chickpea instead of wheat in cycle one.
> That breaks two crop repetitions and cuts eight bare months.
> Not a new system. One change.
> Every number traces back to a published field trial.

Screen beats: form (0–8 s) → button (8–11 s) → recommendation card (11–22 s) → evidence panel (22–27 s).

---

## Project submission page

### High-level summary

FieldShift turns NASA's climate record into one change a farmer can actually make. A farmer in Central Anatolia enters their last crop and whether they can irrigate. FieldShift reads five years of daily NASA POWER temperature and rainfall for that field, runs an FAO-33 seasonal water balance for six regional crops, and — when the farmer enters their own next three crops — tests all 18 ways of changing a single cycle. It returns one recommendation in plain Turkish, with what it improves, what it costs and what it cannot know. It matters because tools in this space either show pictures of the field or ask for a whole new plan; a farmer with one tractor and one buyer changes one thing at a time.

### How it works

A Next.js application. Picking a point on the map queries the NASA POWER daily API for `T2M`, `T2M_MAX`, `T2M_MIN` and `PRECTOTCORR`, 2021–2025, and aggregates it to monthly values, publishing a month only when its daily coverage is complete. For each crop the model builds a seasonal water balance: in-season rainfall plus soil water carried over from the months before planting, against the crop's full seasonal need, converted to an expected yield share by the FAO-33 response function. Three rules then gate every crop — enough complete seasons of temperature and rainfall, some fit to its temperature band, and on a rainfed field a yield share at or above 40%. Surviving crops are ranked into three-cycle plans, and the farmer's own rotation is tested one cycle at a time. The same rules are replayed on the driest complete year on record. On every request the model's own output is compared with 11 published field-trial outcomes and the result is shown in the interface.

### Benefits and intended impact

A farmer gets an answer they can act on this season without changing their machinery, their buyer or their whole plan, and can see exactly which measures improve and by how much. An agronomist can open the same result and inspect every number, source and assumption. The method is not specific to Türkiye: the engine takes a region's crop calendars, water responses and local trials as data, so another region can be added by supplying its own.

### Tools, languages, software

TypeScript, Next.js 16, React 19, Leaflet, Recharts, Vitest. No database, no accounts, no API keys. 139 automated tests.

### NASA data used

- [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) — daily `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, agroclimatology community, UTC, 2021–2025. Every request URL and retrieval time is recorded and shown in the interface.
- [NASA POWER data processing methodology](https://power.larc.nasa.gov/docs/methodology/data/processing/)

### References

| Used for | Source |
| --- | --- |
| Yield response to water (Ky), rooting depth, soil water | [FAO Irrigation and Drainage Paper 56, tables 19, 22, 24](https://www.fao.org/4/x0490e/x0490e0e.htm) |
| Field application efficiency | [FAO Irrigation Water Management, Irrigation Scheduling, Annex I](https://www.fao.org/4/t7202e/t7202e08.htm) |
| Chickpea water use, yield and Ky, Konya | [Tarı & Bahçeci (2022)](https://doi.org/10.15316/SJAFS.2022.020) |
| Sunflower water use, yield and Ky, Konya | [Gündüz et al. (2018)](https://dergipark.org.tr/tr/download/article-file/595097) |
| Rainfed and irrigated wheat, Ankara, four seasons | [Ilbeyi et al. (2006)](https://doi.org/10.1016/j.agwat.2005.08.005) |
| Wheat in rotation against continuous wheat, 21 years | [Cayci et al. (2009)](https://doi.org/10.1016/j.still.2008.09.004) |
| Crop temperature and pH bands | FAO EcoCrop data sheets, linked per crop in `src/data/crops.json` |
| Map tiles | Esri World Imagery, OpenStreetMap contributors |

AI assistance: Claude and Codex were used to write and review code. All data sources, agronomic parameters and field-trial figures are cited above and in `docs/validity-evidence.md`.

---

## Checklist before submitting

- [ ] Every team member registered for the Ankara local event and listed on the team's Members tab
- [ ] Demo uploaded: 7 slides, or a 30-second video with English subtitles if not spoken in English
- [ ] Project submission page complete and in English
- [ ] Every external resource listed in the References field
- [ ] Both confirmation boxes ticked
- [ ] Submitted before **Sunday 15 November, 23:59 Ankara time**
