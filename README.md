# Google Timeline: Country Parser

This project parses the location history information from your [Google Takeout](https://takeout.google.com/settings/takeout).

Make sure your directory looks something like:

```
google-timeline-country-parser/
├─ README.md
├─ index.js
├─ Takeout/
│  ├─ Location History/
│    ├─ Records.json
|    ├─ Settings.json
│    ├─ 201X/
│      ├─ 201X_JANUARY.json
│      ├─ 201X_FEBRUARY.json
│      ├─ 201X_MARCH.json
│      ├─ ...
│    ├─ 202X/
│      ├─ ...
├─ ...
```

This should just be moving the Takeout history into the root folder.

Then just run:

```sh
yarn
yarn start <year>
```

Where year is one (or more) of the years in your `Location History` folder.

Output should look something like:

```sh
> yarn start 2021

Missing: 2021-01-01
{
  'Puerto Rico': 252,
  'United States of America': 34,
  Sweden: 30,
  Germany: 16,
  Portugal: 14,
  'United Kingdom': 4,
  'Republic of Serbia': 1,
  Spain: 12
}
Total Days: 364
```
