# METAR Reader

A vanilla JS + Node.js web app that fetches live METAR aviation weather reports from [aviationweather.gov](https://aviationweather.gov) and decodes them into plain English.

## Architecture

```
METAR-Reader/
├── back/
│   └── server.js       # Node.js HTTP server (no framework)
└── front/
    ├── html/index.html
    ├── css/styles.css
    └── js/app.js       # All parsing + rendering logic
```

**No build step.** No bundler, no transpiler, no dependencies beyond Node stdlib.

- **Backend** (`back/server.js`): single-file Node HTTP server. Proxies `/metar?ids=XXXX` to the Aviation Weather API and serves static files from `front/`.
- **Frontend** (`front/js/app.js`): vanilla JS. Fetches from the local proxy, parses the raw METAR string with a hand-written tokenizer (`parseMETAR`), and renders HTML directly via `innerHTML`.

## Dev workflow

```bash
npm start          # starts server at http://localhost:3000
```

No test runner, no linter config. Reload the browser to see frontend changes; restart the server for backend changes.

## Key conventions

- **CommonJS** (`"type": "commonjs"` in package.json). Use `require`/`module.exports`, not ESM.
- **No external packages.** Keep it dependency-free. Don't add npm packages without a strong reason.
- **No framework.** DOM manipulation is done with `innerHTML` and `getElementById`. Keep it that way.
- **No build step.** Scripts are served directly; don't introduce a bundler.
- `escHtml()` in `app.js` must wrap any user-supplied or API-returned string before injecting into `innerHTML` to prevent XSS.

## METAR parsing

The parser lives entirely in `parseMETAR()` in `front/js/app.js`. It tokenizes the raw METAR string left-to-right using regex tests. Fields parsed in order:

1. Station ID
2. Date/time (`DDHHMMZ`)
3. Modifier (`AUTO`/`COR`)
4. Wind (including variable sector)
5. Visibility (`SM`, metric `9999`, `CAVOK`)
6. RVR (skipped)
7. Weather phenomena
8. Sky conditions
9. Temp/dewpoint
10. Altimeter (`A` = inHg, `Q` = hPa)

The upstream API endpoint is `https://aviationweather.gov/api/data/metar?ids=<ICAO>`.
