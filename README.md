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

## Deployment

These scripts are pasted into Webflow's custom code settings (either site-level or page-level embed blocks in the Designer). To deploy changes:

1. Edit the JS file in this repo
2. Commit and push to `main`
3. Copy the updated script into the corresponding Webflow custom code block
4. Publish the site in Webflow

## Webflow Site

| Property | Value |
|---|---|
| Site ID | `65bd65781616294487f4f4e9` |
| Domain | [oregon-point.com](https://www.oregon-point.com) |
| Designer | [oregon-point.design.webflow.com](https://oregon-point.design.webflow.com) |

See [DEVELOPER.md](DEVELOPER.md) for full site architecture, CMS schemas, component inventory, and integration details.
