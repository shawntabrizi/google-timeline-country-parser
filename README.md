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

Add this file to the root of this project.

```sh
Usage: index [options]

Options:
  -y, --years <years>                Comma-separated list of years or ranges (e.g., '2014,2016-2018')
  -i, --input <file>                 Input file name (default: "Timeline.json")
  -o, --output <file>                Output file name (default: "output.json")
  -p, --preferred-country <country>  Preferred country to prioritize when handling ambiguous locations
  -h, --help                         display help for command
✨  Done in 0.73s.
```

Where year is one (or more) of the years in your `Location History` folder.

Output should look something like:

```sh
> yarn start -y 2021

✔ Processing Complete!
{
  '2021': {
    'Puerto Rico': 257,
    Sweden: 30,
    Germany: 16,
    'United States': 29,
    Portugal: 14,
    'United Kingdom': 4,
    Serbia: 1,
    Spain: 13
  }
}
{ days_in_year: 365, days_missing: 1, days_guessed: 118 }
Location history saved to output.json
```
