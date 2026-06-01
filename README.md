# METAR Reader

A lightweight web app that fetches live METAR aviation weather reports and decodes them into plain English — no dependencies, pure Node.js.

## What is METAR?

METAR (Meteorological Aerodrome Report) is the standard format used worldwide for reporting current weather conditions at airports. This app translates those compact, cryptic strings into human-readable summaries with individual cards for temperature, wind, visibility, sky conditions, dewpoint, and pressure.

## Features

- Live weather data from [aviationweather.gov](https://aviationweather.gov)
- Decodes wind, visibility, sky cover, temperature, dewpoint, and altimeter
- Plain-English summary with weather emoji
- Beaufort scale wind description
- Humidity and comfort indicators
- Works with any 4-letter ICAO airport code (e.g. `KLAX`, `KJFK`, `EGLC`)

## Getting Started

**Requirements:** Node.js 18+

```bash
git clone https://github.com/netanelmizrahi/metar-reader.git
cd metar-reader
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
metar-reader/
├── back/
│   └── server.js        # Node.js HTTP server + METAR proxy
└── front/
    ├── html/
    │   └── index.html   # App markup
    ├── css/
    │   └── styles.css   # Styles
    └── js/
        └── app.js       # METAR parser, renderer, and UI logic
```

## How It Works

1. The browser sends a request to `/metar?ids=KLAX`
2. The Node.js server proxies the request to `aviationweather.gov`
3. The raw METAR string is returned to the browser
4. `app.js` parses the string token-by-token and renders the result as weather cards

## License

MIT
