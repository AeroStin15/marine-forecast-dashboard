# Marine Forecast Dashboard v8

Static, phone-friendly marine forecast dashboard for GitHub Pages.

## What is new in v8

- App-style top summary card.
- Open Gulf South of Ship preset moved farther south: `29.960, -88.950`.
- Trip Planner Mode: highlights run-out, fishing, and return hours.
- Real-time NOAA/NDBC buoy section for station 42357 using a GitHub Actions cache.
- Proper repository structure with `.github/workflows/update-buoy.yml` included.

## Upload instructions

Upload the CONTENTS of this folder to the root of your GitHub repo, not the folder itself.

Your repo should look like this:

```text
index.html
app.js
styles.css
README.md
data/buoy-42357.txt
.github/workflows/update-buoy.yml
```

## GitHub Action setup

1. Go to Settings > Actions > General.
2. Under Workflow permissions, choose Read and write permissions.
3. Go to the Actions tab.
4. Run `Update NDBC buoy cache` once manually.

After that, GitHub will update the buoy cache about every 30 minutes.
