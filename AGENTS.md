# Architecture

MY GARAGE v7.0 evolves the uploaded standalone v6, rather than replacing its data model or features. Frontend is a static Ukrainian-language application in `public/index.html`, with the original v6 implementation followed by v7 extensions. Some original renderers are named `v6VehicleForm`, `v6RecordForm`, `v6FuelLogForm`, and `v6Detail`; v7 wrappers add fields while retaining their behavior. `public/v7.css` provides the desktop sidebar and iPhone bottom navigation. `public/sw.js` caches only the public shell, never API responses.

`netlify/functions/garage.mts` serves `/api/garage` and `/api/file`. Garages are isolated by an HttpOnly browser cookie. Database records are versioned JSONB aggregates to retain unknown legacy properties. Optimistic revision matching prevents multiple tabs from silently overwriting data. Previous aggregates are retained in `garage_revisions`. Attachments are content-addressed in Netlify Blobs and hydrated for portable JSON exports. No account login or cross-device synchronization is implemented.

`db/schema.ts` is the Drizzle source of truth. Migrations are in `netlify/database/migrations` and are applied by Netlify, never manually. Drizzle packages must use the beta release line for the native Netlify adapter. Netlify publishes `public` without a frontend build.

# Conventions

Keep Ukrainian UI copy, `esc()` all inserted user text, and preserve `vehicles`, `serviceRules`, `carRecords`, `fuelups`, and unknown backup fields. Existing browser storage is read only for v6 migration; new application records must persist via Netlify primitives. Appearance preferences may remain browser settings. Never put personal records in source control or seed fictitious vehicles as user data.

Keep fuel types separate, especially LPG/petrol and electricity units. Full-tank consumption uses accumulated fuel after the preceding full tank, including partial fills. Fleet distance is a sum of individual car distances and must be unavailable when a participating car lacks distance evidence. Costs per distance are explicitly partial estimates. Fault costs are not counted automatically in expense analytics, to avoid double counting a repair also entered in maintenance history.

Forms use existing field IDs referenced by save handlers. When changing them, update renderers and handlers together. Respect 16px mobile inputs, 44px touch targets, safe areas, reduced motion, and PWA cache versioning. Photo/PDF data stays in portable backups; large attachments upload separately before the metadata snapshot.

# Validation

This delivery was reviewed by reading source only; no runtime, build, or browser checks were performed in the implementation session. Do not mark iPhone/PWA, live database round trips, or actual user backup migration as verified until exercised. See README for launch instructions and known limitations.
