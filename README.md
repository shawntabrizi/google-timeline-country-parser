# Google Timeline: Country Parser

This project parses the location history information from your Google Location Services Timeline.

NOTE: [Google recently changed](https://support.google.com/maps/answer/14169818) their privacy settings so that all timeline history is now stored locally on your phone. This repo supports this latest format.

To get your Google Location Services Timeline data, you must export it from your device:

- Go to: Settings
  - Location
    - Location Services
      - Timeline
        - Export Timeline data

The output should be a single file called `Timeline.json`.

Add this file to the root of this project, then just run:

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
