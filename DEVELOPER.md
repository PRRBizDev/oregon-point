# Developer Documentation

Technical reference for the Oregon Point Webflow site. For setup and usage, see [README.md](README.md).

## Table of Contents

- [Site Info](#site-info)
- [Architecture](#architecture)
- [Custom Code Reference](#custom-code-reference)
- [Third-Party Integrations](#third-party-integrations)
- [CMS Collections](#cms-collections)
- [Components](#components)
- [Pages](#pages)
- [CSS & Data Attribute Contracts](#css--data-attribute-contracts)

---

## Site Info

| Property | Value |
|---|---|
| Site ID | `65bd65781616294487f4f4e9` |
| Workspace ID | `6306981cce22911d7d48cea3` |
| Short Name | `oregon-point` |
| Domains | `oregon-point.com`, `www.oregon-point.com` |
| Timezone | America/Los_Angeles |
| Localization | English only |
| Repository | `https://github.com/PRRBizDev/oregon-point.git` |
| Default Branch | `main` |

---

## Architecture

### Page Layout Pattern

Every page follows this component structure:

```
[Google Tag Manager - Custom Code]
[Global Styles]
[Navbar Alternate]
  ... page content ...
[Footer Alternate]
```

### Schedule Data Flow

```
Google Sheets (source of truth)
    ↓  Published as CSV
load-route-schedules.js (client-side fetch on DOMContentLoaded)
    ↓  Parsed & rendered as HTML <table>
DOM: #westboundSchedule, #eastboundSchedule, #southboundSchedule, #northboundSchedule
```

Schedule data lives in a single Google Sheet with one tab (GID) per route/direction. The script runs on page load and renders tables client-side. No server-side processing.

### Stop Data Flow

```
Webflow CMS (Route Stops collection)
    ↓  Rendered server-side via CMS bindings
DOM: .select_stop-dropdown-link, .connection-list-item, .parking-list-item
    ↓  Enhanced client-side
load-stop-data.js (sorting + filter-on-click)
```

### Performance Dashboard

The Performance section uses a hybrid static/CMS approach:

- **Hub** (`/performance`) — Hardcoded aggregate metrics, filter dropdowns link to sub-pages
- **Per-route** (`/performance/{route}`) — Static pages with route-specific dashboards
- **Per-metric** (`/performance/{metric}`) — Static pages for a single metric across routes
- **CMS template** (`/performance-collection/{slug}`) — CMS-driven, embeds dashboards via RichText fields

### Key Architectural Decisions

- **No code components library.** Custom JS is standalone scripts, not Webflow React components.
- **Schedules are Google Sheets-driven.** Operators update the spreadsheet; the site reflects changes without a Webflow publish.
- **CMS filtering uses Finsweet Attributes** rather than custom JS for route-based filtering.
- **Notifications are CMS-driven** with a Switch field to toggle visibility without deleting entries.

---

## Custom Code Reference

### `load-route-schedules.js`

Renders route schedule tables from Google Sheets CSV data.

**Data source (published CSV):**
```
https://docs.google.com/spreadsheets/d/e/2PACX-1vSFxEWKQ2-xBzt3yUZR3N2iCroPtJfmrMcLVXacEVAEaxhUZckJCOOvIshUEuJVi5v7CtlcNq_HjoyC/pub?gid={GID}&output=csv
```

**Editor (requires Google access):**
```
https://docs.google.com/spreadsheets/d/1QJOwBfOfgT6-NmBP5PPDoGZCZm3QnVrcfPAnO0jf8AI/edit
```

**Route → GID mapping:**

| Route | Westbound/Southbound | Eastbound/Northbound |
|---|---|---|
| Cascades | `61645532` (Southbound) | `623966074` (Northbound) |
| Northwest | `936462530` (Westbound) | `1006324273` (Eastbound) |
| Eastern | `192720227` (Westbound) | `994232038` (Eastbound) |
| Southwest | `1727388931` (Westbound) | `1800641249` (Eastbound) |

**Behavior (v2.4.0):**
1. Reads route from the last non-empty URL path segment
2. For each direction defined for that route in `ROUTE_TO_GID`, looks for `#{direction}Schedule` in the DOM. Containers for other routes' directions are ignored.
3. If a last-known-good copy of the CSV exists in `localStorage` (`pointSchedule:v1:{gid}`), renders it immediately, then fetches in the background and re-renders only if the data changed
4. Otherwise shows a loading status, fetches with up to 3 attempts (0 / 800 / 2400 ms backoff, 8 s timeout each), parses, validates, renders, and caches
5. If every attempt fails and there is no cache, shows an error status. If there is a cache, keeps the cached table and reports the failure silently.
6. Rows where only the first column has content are treated as full-width breaks (e.g., restroom stops)

**Status region:** each container gets a `<p class="schedule-status" role="status" aria-live="polite" data-state="loading|loaded|error">` as its first child and a `.schedule-host` wrapper around the table widget. `aria-busy` is set on the container while a first load is in flight.

**CSV columns:** `[0] Stop Name` | `[1] Address` | `[2] Map URL` | `[3+] Trip times`

**Validation:** a header with fewer than 4 columns, or no stop rows, blocks rendering (error). Empty time cells, values that do not look like times, and non-http(s) map URLs are warnings: the table still renders and the warning is reported. Use `--` in the sheet for "no stop at this trip"; do not leave time cells empty.

**Telemetry:** events are pushed to `window.dataLayer` (GTM), to `window.gtag` if present, and to `window.POINT_SCHEDULE_BEACON_URL` via `sendBeacon` if that global is set. Set `window.POINT_SCHEDULE_DEBUG = true` to log them to the console.

| Event | Key params |
|---|---|
| `schedule_loaded` | `route`, `direction`, `source` (`network` or `cache`), `ms`, `replaced_cache` |
| `schedule_revalidated` | `route`, `direction`, `changed` |
| `schedule_load_error` | `route`, `direction`, `reason` (`network`, `timeout`, `validation`), `attempts`, `fallback` (`cache` or `none`), `message` |
| `schedule_validation_warning` | `route`, `direction`, `warning_count`, `first_warning` |
| `schedule_validation_error` | `route`, `direction`, `error_count`, `first_error` |

Every event also carries `schedule_version` and `page_path`. To see them in GA4, add a GTM Custom Event trigger for `schedule_load_error` (and optionally `schedule_loaded`) that fires a GA4 Event tag forwarding the parameters above.

**Pure functions:** `parseCsv`, `normalizeRows`, `validateRows`, and `renderTableHtml` are exposed as `window.PointSchedules` and as a CommonJS export for tests and tooling.

### `load-stop-data.js`

Enhances the stop-selection dropdown on route detail pages.

**Behavior:**
1. Collects all `.select_stop-dropdown-link` elements
2. Sorts by `data-sort-order` attribute (ascending integer)
3. Re-orders DOM elements to match sorted order
4. On click: sets `.select_stop-dropdown-link-selected` text, hides all `.connection-list-item` and `.parking-list-item`, shows only `[data-stop-id="{selected}"]` matches

---

## Third-Party Integrations

### Google Tag Manager

Embedded via the `Google Tag Manager - Custom Code` component (ID: `0b0977cf-3da1-c6c3-4f83-06eb6e846de9`), included on every page.

### Finsweet Attributes

[Finsweet CMS Filter](https://finsweet.com/attributes/cms-filter) is used for client-side CMS filtering.

| Attribute | Used On | Purpose |
|---|---|---|
| `fs-cmsfilter-field="routes"` | Routes Template, Performance Dashboard | Filters CMS items by route |
| `fs-list-field="routes"` | Performance Dashboard | Lists items by route |

### Google Sheets

Schedule data is sourced from a published Google Sheet. See [Custom Code Reference](#load-route-schedulesjs) for details.

---

## CMS Collections

### Relationship Diagram

```
Routes (central entity)
 ├─< Route Stops       (MultiReference ↔ Routes)
 ├─< Route Schedules   (Reference → Routes)
 ├─< News Updates      (Reference → Routes)
 ├─< Tickets           (Reference → Routes)
 │    └─< Stations     (MultiReference → Tickets)
 ├─< Policies/Amenities (matched by name convention)
 └─< Performance Metrics (Reference → Routes)

Notifications (standalone — no route reference)
```

### Routes

**ID:** `6610694ec66806a7fba4a3bf` · **Slug:** `routes`

Central entity — nearly every other collection references this.

| Field | Slug | Type | Required | Notes |
|---|---|---|---|---|
| Name | `name` | PlainText | Yes | Max 256 |
| Slug | `slug` | PlainText | Yes | Do not edit |
| Sort Order | `sort-order` | Number | Yes | Int 0–100, lower first |
| Route Title (Shortened) | `route-title-shortened` | PlainText | Yes | For menus/UI |
| Route Summary | `route-summary` | PlainText | Yes | Multiline |
| Route Map | `route-map` | Image | Yes | Max 2500x2000 |
| Schedule Description | `schedule-description` | RichText | Yes | |
| Route Tickets Description | `route-tickets-amentities` | RichText | Yes | |
| Tickets Page URL | `tickets-page-url` | Link | Yes | |
| Route Amenities Description | `route-amenities-description` | RichText | Yes | |
| Amenities Page URL | `amenities-page-url` | Link | Yes | |
| Route Operator | `route-operator` | Option | Yes | See below |
| Route Stops | `route-stops` | MultiRef → Route Stops | Yes | |
| Route Schedules | `route-schedules` | MultiRef → Route Schedules | Yes | |
| Page Metadata Description | `page-metadata-description` | PlainText | Yes | Max 160 (SEO) |

**Route Operator options:** `Northwest Navigator Luxury Coaches`, `MTRWestern`, `Pacific Crest Bus Lines`

### Stations

**ID:** `6610759367a1fbf3d3d78979` · **Slug:** `stations`

| Field | Slug | Type | Required |
|---|---|---|---|
| Name | `name` | PlainText | Yes |
| Slug | `slug` | PlainText | Yes |
| Ticketing Route(s) | `ticketing-station-s-2` | MultiRef → Tickets | Yes |
| Station Details | `station-details` | RichText | Yes |
| Station URL | `station-url` | Link | No |

### Notifications

**ID:** `661075a492b350011f6b440f` · **Slug:** `notifications`

| Field | Slug | Type | Required | Notes |
|---|---|---|---|---|
| Name | `name` | PlainText | Yes | Internal title |
| Slug | `slug` | PlainText | Yes | |
| Notification Type | `type-of-notification` | Option | Yes | `Informational`, `Service Alert`, `Warning` |
| Notification Status | `notification-status` | Switch | No | Toggle visibility |
| Message | `message` | RichText | Yes | Max 240 chars |

### Policies and Amenities

**ID:** `661075b2f5ffaba956663d3d` · **Slug:** `amenities-support`

One entry per route.

| Field | Slug | Type | Required |
|---|---|---|---|
| Name | `name` | PlainText | Yes |
| Slug | `slug` | PlainText | Yes |
| Page Metadata Description | `page-metadata-description` | PlainText | Yes |
| Trip Connections | `trip-connections` | RichText | Yes |
| Restrooms | `restrooms` | RichText | No |
| Restrooms Image | `restrooms-image` | Image | No |
| Wi-Fi | `wi-fi` | RichText | Yes |
| Outlets | `outlets-on-board` | RichText | Yes |
| Outlets Thumbnail Image | `outlets-image` | Image | No |
| Outlet Image(s) | `outlet-images` | MultiImage | No |
| Parking | `parking` | RichText | No |
| Luggage Limits | `luggage-limits` | RichText | Yes |
| Bikes | `bikes` | RichText | Yes |
| Bikes Image | `bike-image` | Image | No |
| Seat Belts | `seat-belts` | RichText | Yes |
| Car Seats | `car-seats` | RichText | Yes |
| Lost Items | `lost-items` | RichText | Yes |
| Animals | `animals` | RichText | Yes |
| Age Policy | `age-policy` | RichText | Yes |

### Route Stops

**ID:** `6610862e8f6d284467c59eaa` · **Slug:** `route-stops`

| Field | Slug | Type | Required |
|---|---|---|---|
| Name | `name` | PlainText | Yes |
| Slug | `slug` | PlainText | Yes |
| Associated Routes | `associated-routes` | MultiRef → Routes | Yes |
| Stop Connections | `stop-connections` | RichText | Yes |
| Stop Parking | `stop-parking` | RichText | Yes |
| Stop Location Name | `stop-location-name` | PlainText | No |
| Stop Address | `stop-address` | PlainText | No |
| Stop URL | `stop-url-2` | Link | No |
| Sort Order | `sort-order` | Number | No |

### Route Schedules

**ID:** `6615c40f7f0a9098129e1795` · **Slug:** `route-schedules`

| Field | Slug | Type | Required | Notes |
|---|---|---|---|---|
| Route Name (full length) | `name` | PlainText | Yes | e.g., "Portland to Astoria (Westbound)" |
| Slug | `slug` | PlainText | Yes | |
| Route | `route` | Ref → Routes | Yes | |
| Route Direction | `route-direction` | Option | Yes | 8 directional options (see below) |
| Route Footnotes | `route-footnotes` | RichText | No | |

**Direction options:** `Cascades (Northbound)`, `Cascades (Southbound)`, `Northwest (Westbound)`, `Northwest (Eastbound)`, `Eastern (Westbound)`, `Eastern (Eastbound)`, `Southwest (Westbound)`, `Southwest (Eastbound)`

### News Updates

**ID:** `6615f85e6588f044aeed3e76` · **Slug:** `service-updates`

| Field | Slug | Type | Required |
|---|---|---|---|
| Name | `name` | PlainText | Yes |
| Slug | `slug` | PlainText | Yes |
| Route | `route` | Ref → Routes | Yes |
| Alert Date/Time | `alert-date-time` | DateTime | Yes |
| Alert Content | `alert-content` | RichText | Yes |
| Image | `image` | Image | No |
| Image Alt-Text | `image-alt-text` | PlainText | No |

### Tickets

**ID:** `6616cd4aa444ff611a217d4f` · **Slug:** `tickets`

| Field | Slug | Type | Required |
|---|---|---|---|
| Name | `name` | PlainText | Yes |
| Slug | `slug` | PlainText | Yes |
| Sort Order | `sort-order` | Number | Yes |
| Routes | `routes` | Ref → Routes | Yes |
| Summary | `summary` | RichText | Yes |
| Online Ticket Purchase Description | `online-ticket-purchases` | RichText | Yes |
| Phone Ticket Purchase Description | `phone-ticket-purchases` | RichText | Yes |
| In-Person Purchase Description | `in-person-purchase-description` | PlainText | Yes |
| Purchase Notice(s) | `purchase-notice-s` | RichText | No |
| Ticket Stations | `ticket-stations` | MultiRef → Stations | Yes |
| Page Metadata Description | `metadata-description` | PlainText | Yes |

### Performance Metrics

**ID:** `68bb352a5ed42af7751b4b8d` · **Slug:** `performance-collection`

| Field | Slug | Type | Required |
|---|---|---|---|
| Name | `name` | PlainText | Yes |
| Slug | `slug` | PlainText | Yes |
| Route | `route` | Ref → Routes | Yes |
| Monthly Ridership Dashboard | `monthly-ridership-dashboard` | RichText | Yes |
| On-Time Performance Dashboard | `on-time-performance-dashboard` | RichText | Yes |
| Cost Per Mile Dashboard | `cost-per-mile-dashboard` | RichText | Yes |
| Fare Box Recovery | `fare-box-recovery` | RichText | Yes |

Dashboard fields use RichText to embed visualizations (iframe or chart embed code).

---

## Components

### Layout (used on every page)

| Component | ID | Group |
|---|---|---|
| Google Tag Manager - Custom Code | `0b0977cf-3da1-c6c3-4f83-06eb6e846de9` | — |
| Global Styles | `5ffad809-50c0-31dd-2ebc-e3eb71f28b9b` | — |
| Navbar Alternate | `13c10fc1-8b52-80e7-fc40-44dd4548cce9` | Navbars |
| Footer Alternate | `915a92eb-d493-219e-cfbb-d301a16a0d89` | Footers |

### Legacy (unused or secondary)

| Component | ID | Group |
|---|---|---|
| navbar | `71e2351e-6b66-a052-93af-0ae4b890470c` | Navbars |
| footer | `e126d838-5364-515e-795e-b9bab9f7a700` | Footers |

### Dropdowns

| Component | ID | Used On |
|---|---|---|
| route selector | `1f7be715-e7ca-d129-26e4-9ac886ba4850` | Routes Template |
| service updates route selector | `4ed4946f-4172-4179-60fb-c7869da661a0` | News pages |
| Performance Dashboard Filter Dropdowns | `88c483db-beea-079e-6aa4-3c941ea50536` | Performance hub |

The Performance Dashboard Filter contains two groups:
- **Filter by route** — links to `/performance/{route-slug}`
- **Filter by metric** — links to `/performance/{metric-slug}`

### Schedule (8 components, one per direction)

| Component | ID | Direction |
|---|---|---|
| Cascades - Northbound | `69c28c92-a0e3-ee61-7a7c-02099c9c3185` | Eugene → Portland |
| Cascades - Southbound | `c14831eb-139e-f2d5-492f-611f8ea5f087` | Portland → Eugene |
| Northwest - Westbound | `86c08464-4524-0f57-5f16-fe6091873aa1` | Portland → Astoria |
| Northwest - Eastbound | `88fe2c23-c4db-c483-ebb6-ef0a82a15df2` | Astoria → Portland |
| Eastern - Westbound | `1630b8b4-20a0-df16-8727-e814b43adcdd` | Ontario → Bend |
| Eastern - Eastbound | `9f139d1d-3a17-251c-c604-6349d2dbb273` | Bend → Ontario |
| Southwest - Westbound | `fdec4c36-5dc4-fbff-763c-83458b0d1e83` | Klamath Falls → Brookings |
| Southwest - Eastbound | `f08a77de-72c5-81bb-c6ca-0249d2d5c5a9` | Brookings → Klamath Falls |

### Other

| Component | ID | Purpose |
|---|---|---|
| policy component | `990bc279-f94d-9977-9892-b41ce882139a` | Reusable policy content block |
| Metric Definitions | `f8ce49ce-5487-9675-7b20-fd3280c5f7b7` | Explains the four performance metrics |

---

## Pages

### Static (9)

| Page | Path |
|---|---|
| Home | `/` |
| Routes | `/routes` |
| Route Map | `/route-map` |
| Why Ride? | `/why-ride` |
| Tickets | `/tickets` |
| Policies & Amenities | `/amenities-support` |
| Contact | `/contact-us` |
| Performance | `/performance` |
| News | `/news` |

### News sub-pages (4)

| Page | Path |
|---|---|
| News - Cascades | `/news/cascades` |
| News - NorthWest | `/news/northwest` |
| News - Eastern | `/news/eastern` |
| News - SouthWest | `/news/southwest` |

### Performance sub-pages (8)

| Page | Path | Filter |
|---|---|---|
| Monthly Ridership | `/performance/monthly-ridership` | By metric |
| On-Time Performance | `/performance/on-time-performance` | By metric |
| Cost per Mile | `/performance/cost-per-mile` | By metric |
| Farebox Recovery | `/performance/farebox-recovery` | By metric |
| Cascades | `/performance/cascades` | By route |
| Eastern | `/performance/eastern` | By route |
| NorthWest | `/performance/northwest` | By route |
| SouthWest | `/performance/southwest` | By route |

### CMS Templates (9)

| Template | Path Pattern | Collection |
|---|---|---|
| Routes | `/routes/{slug}` | Routes |
| Tickets | `/tickets/{slug}` | Tickets |
| Policies & Amenities | `/amenities-support/{slug}` | Policies and Amenities |
| Route Stops | `/route-stops/{slug}` | Route Stops |
| Route Schedules | `/route-schedules/{slug}` | Route Schedules |
| Stations | `/stations/{slug}` | Stations |
| Notifications | `/notifications/{slug}` | Notifications |
| News Updates | `/service-updates/{slug}` | News Updates |
| Performance Metrics | `/performance-collection/{slug}` | Performance Metrics |

### Utility (3)

| Page | Path | Status |
|---|---|---|
| 404 | `/404` | Published |
| Password | `/401` | Published |
| Style Guide | `/style-guide` | Draft |

---

## CSS & Data Attribute Contracts

These classes and attributes are referenced by JavaScript. Renaming or removing them will break functionality.

### Classes used by `load-route-schedules.js`

| Class | Purpose |
|---|---|
| `.tablepress` | Applied to generated schedule `<table>` |
| `.table_row` | Applied to generated `<tr>` elements |
| `.table_cell` | Applied to generated `<td>` elements |

### Classes used by `load-stop-data.js`

| Class | Purpose |
|---|---|
| `.select_stop-dropdown-toggle` | Dropdown trigger element |
| `.select_stop-dropdown-link-selected` | Displays current selection text |
| `.select_stop-dropdown-link` | Individual dropdown option |
| `.connection-list-item` | Filterable transit connection entry |
| `.parking-list-item` | Filterable parking info entry |

### Data attributes used by `load-stop-data.js`

| Attribute | Purpose |
|---|---|
| `data-stop-id` | Links content blocks to a stop name for filtering |
| `data-sort-order` | Integer sort order for dropdown items |

### DOM IDs used by `load-route-schedules.js`

| ID | Purpose |
|---|---|
| `#westboundSchedule` | Container for westbound schedule table |
| `#eastboundSchedule` | Container for eastbound schedule table |
| `#southboundSchedule` | Container for southbound schedule table |
| `#northboundSchedule` | Container for northbound schedule table |

### Finsweet attributes

| Attribute | Purpose |
|---|---|
| `fs-cmsfilter-field="routes"` | CMS Filter: filters items by route |
| `fs-list-field="routes"` | CMS Filter: lists items by route |
