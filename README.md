# Marine Forecast Dashboard v9

## v9 changes
- Rebuilt rating logic so wave height dominates.
- Waves under 1 ft stay Good unless wind/gusts are genuinely high.
- Short period only downgrades ratings once seas are at least 1.5 ft.
- Buoy refresh now uses cache-busting and `cache: no-store`.
- Buoy loading attempts live NDBC first, then falls back to `data/buoy-42357.txt`.
- GitHub Action included to update the cached buoy file every 30 minutes.

## Upload structure
Upload the contents of this folder to the repo root:

```
index.html
app.js
styles.css
README.md
data/buoy-42357.txt
.github/workflows/update-buoy.yml
```

Do not upload the outer `marine_forecast_static_v9` folder itself.

## GitHub Actions setup
Repository Settings → Actions → General → Workflow permissions → Read and write permissions.
Then run the `Update NDBC buoy cache` workflow once manually.
