# Marine Forecast Consensus Dashboard - Static Phone Version v3

This version runs entirely in the browser. It does not need Flask, Python, or a paid server.

## What changed in v3

- Added wind speed, wind gusts, and wind direction when available.
- Wind is shown in **mph**, not knots.
- Wind comes from the Open-Meteo Weather Forecast API, while waves still come from the Open-Meteo Marine API.
- Rating logic now considers wind: under 2 ft can still show Caution if period is under 5 seconds, sustained wind is about 15+ mph, or gusts are about 22+ mph.
- Keeps v2 changes: less conservative sub-2-foot ratings, forecast days, and the South of Ship Island / Chandeleur Run preset.

## Files

- `index.html`
- `styles.css`
- `app.js`

## Free phone-friendly hosting option: GitHub Pages

1. Create a free GitHub account if you do not already have one.
2. Create a new public repository, for example: `marine-forecast-dashboard`.
3. Upload `index.html`, `styles.css`, and `app.js` to the repository root.
4. Go to the repository's **Settings**.
5. Go to **Pages**.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Choose branch `main` and folder `/root`, then save.
8. GitHub will give you a URL like:
   `https://YOURUSERNAME.github.io/marine-forecast-dashboard/`

Open that URL from your phone. In Safari or Chrome, use "Add to Home Screen" to make it feel like an app.

## Notes

- Default coordinates are around 29.43, -88.43.
- The dashboard pulls Open-Meteo Marine API wave data and Open-Meteo Weather Forecast API wind data directly from the browser.
- If a live wave source fails, that panel falls back to demo wave data so the dashboard still opens.
- If wind is unavailable, wind columns show blanks and the rating falls back to wave/period/spread logic.
- This is for planning/awareness only. Do not use it as a substitute for official marine warnings, navigation tools, or judgment on the water.
