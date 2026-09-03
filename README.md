# Oregon Point (POINT)

Custom code for [oregon-point.com](https://www.oregon-point.com) — Oregon's intercity transit service operated by ODOT. The Webflow site serves four daily bus routes: Cascades, NorthWest, Eastern, and SouthWest.

This repo contains client-side JavaScript embedded in the Webflow Designer as custom code blocks. There is no build system or dependencies.

## Files

| File | Purpose |
|---|---|
| `load-route-schedules.js` | Fetches route schedule data from Google Sheets and renders HTML tables on route detail pages |
| `load-stop-data.js` | Sorts and filters the stop-selection dropdown on route detail pages |

## How It Works

### Schedule Tables

`load-route-schedules.js` reads the route slug from the URL, maps it to a Google Sheets tab (GID), fetches the published CSV, and renders a schedule table into the page.

**To update schedule data:** Edit the [Google Sheet](https://docs.google.com/spreadsheets/d/1QJOwBfOfgT6-NmBP5PPDoGZCZm3QnVrcfPAnO0jf8AI/edit) directly. Changes appear on the site automatically since the sheet is published as CSV.

**CSV column format:** Stop Name | Address | Map URL | Trip 1 | Trip 2 | ...

### Stop Dropdown

`load-stop-data.js` enhances the CMS-rendered stop dropdown on route pages. It sorts options by `data-sort-order` and filters `.connection-list-item` and `.parking-list-item` elements by `data-stop-id` when a stop is selected.

## Tests

No dependencies. Node 20+.

```
node --test "test/**/*.test.js"
```

Covers the CSV parser, validation, and table renderer against fixtures modeled on the live sheets plus malformed inputs (blank cells, quotes, CRLF, BOM, unsafe URLs).

## Deployment

Scripts are served from jsDelivr, pinned to a git tag with Subresource Integrity, and referenced from Webflow custom code. To deploy a change:

1. Edit the JS file in this repo and run the tests
2. Commit and push to `main`
3. Tag the release (`git tag v.X.Y.Z && git push --tags`)
4. Compute the SRI hash of the file as served by jsDelivr:
   `curl -s https://cdn.jsdelivr.net/gh/PRRBizDev/oregon-point@v.X.Y.Z/load-route-schedules.js | openssl dgst -sha384 -binary | openssl base64 -A`
5. Update the `<script>` tag in Webflow (URL and `integrity`), publish to the `webflow.io` staging domain, verify, then publish to production

Tags are immutable once referenced: never move a tag after it has been used in a script URL. A moved tag will fail SRI on some CDN edges and not others, which shows up as schedules that load for some visitors and not for others.

## Webflow Site

| Property | Value |
|---|---|
| Site ID | `65bd65781616294487f4f4e9` |
| Domain | [oregon-point.com](https://www.oregon-point.com) |
| Designer | [oregon-point.design.webflow.com](https://oregon-point.design.webflow.com) |

See [DEVELOPER.md](DEVELOPER.md) for full site architecture, CMS schemas, component inventory, and integration details.
