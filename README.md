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
