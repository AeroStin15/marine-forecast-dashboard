# Marine Forecast Dashboard v5

Phone-friendly static marine dashboard for GitHub Pages.

## v5 changes

- Adds a **Planning ft** column that uses the higher of the model average or the highest model for that hour.
- Adds a **Planning sec** column that prioritizes short-period wind chop when wind waves are meaningful.
- Adds **Sea type** labels such as Short chop, Mixed chop, Swell-led, and Moderate.
- Rating logic now uses Planning ft + Planning sec instead of the smoother average wave period.

This helps prevent a long swell period from hiding short, stacked wind chop.

## Deployment

Upload/replace these files in your GitHub Pages repo:

- index.html
- styles.css
- app.js

Then commit the changes.


## v6 changes

- Moved the South of Ship Island / Chandeleur Run preset farther south into more exposed Gulf water: `30.020, -88.950`.
- Added a real-time NOAA/NDBC buoy section for station `42357`.
- The buoy panel reads the NDBC realtime text feed (`https://www.ndbc.noaa.gov/data/realtime2/42357.txt`), converts wave height from meters to feet, wind from meters/second to mph, and water temperature from Celsius to Fahrenheit.
- Buoy data is displayed separately as a reality check and is not averaged into the future model forecast.


## v7 buoy-fetch fix

NOAA/NDBC real-time text files are perfect for scripts, but many phone browsers and GitHub Pages sites cannot fetch them directly because of browser CORS rules. This version avoids that by trying a same-site cached file first: `data/buoy-42357.txt`.

The included GitHub Action at `.github/workflows/update-buoy.yml` refreshes that cached file from NDBC every 30 minutes. After uploading these files to your GitHub repository:

1. Go to your repository on GitHub.
2. Open **Settings → Actions → General**.
3. Under **Workflow permissions**, choose **Read and write permissions** and save.
4. Open the **Actions** tab.
5. Run **Update NDBC buoy cache** once manually.
6. After that, it will refresh every 30 minutes.

If the action has not run yet, the dashboard will still show the included sample cache until GitHub replaces it with live NDBC data.
