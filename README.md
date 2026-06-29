# Marine Forecast Dashboard v10

Simple mobile-first marine forecast dashboard.

## What changed in v10

- Keeps the cleaner v9 UI and rating logic.
- Removes the embedded buoy fetch that was unreliable on GitHub Pages/mobile browsers.
- Adds a **Before You Go** link section instead:
  - NOAA Buoy 42357 station page
  - NDBC raw wave data
  - NOAA Mobile/Pensacola marine forecast page
  - Point marine forecast near the open Gulf / Ship Island preset

## Upload

Upload the contents of this folder to the root of your GitHub repository:

- `index.html`
- `app.js`
- `styles.css`
- `README.md`

You can leave old `data/` and `.github/workflows/` files in the repo, but they are no longer used by the dashboard.
