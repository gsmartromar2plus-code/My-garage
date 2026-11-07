# MY GARAGE v8 development rules

## Source and compatibility
- v8 is developed from the user-provided v7 source archive. Do not rebuild the application from scratch.
- Preserve the existing vehicle model and all legacy fields: `vehicles`, `serviceRules`, `carRecords`, `fuelups`, documents, events, breakdowns, budgets, unknown JSON fields, and attachments.
- Do not remove or silently rename existing features. Keep the old Netlify files only as migration/reference material; v8 deploys through Cloudflare Workers.
- Never seed fictitious cars or personal records. Never migrate production data automatically.

## Architecture
- Frontend: static Ukrainian PWA in `public/`.
- API: Cloudflare Worker in `worker/index.ts`.
- Database: Cloudflare D1, schema migrations in `migrations/`.
- Media: Cloudflare R2.
- Authentication: Google OAuth and one-time email links; sessions are opaque, hashed server-side, HttpOnly, Secure cookies.
- Derive user identity only from the validated server session. Never accept browser-provided user IDs as authorization.
- Garage rows and R2 keys are user-scoped. Keep optimistic revision checks for garage writes.
- Blog visibility is per post. Enforce visibility on the server for both post content and every media request; a private post and its media are author-only.

## Frontend conventions
- Keep Ukrainian UI copy; escape user-provided strings with `esc()` before HTML insertion.
- Keep mobile inputs at least 16px and touch targets at least 44px; respect safe areas and reduced motion.
- Service Worker caches only the public shell. Never cache API/auth/private content.
- Preserve full-tank fuel calculation semantics and keep LPG/petrol/electric units separate.
- Fleet distance is unavailable when any participating car lacks distance evidence. Cost-per-distance is explicitly a partial estimate.

## Data and security
- Never put API secrets, OAuth secrets, email provider keys, or real personal data in source control.
- Do not expose R2 object keys or direct bucket URLs for private blog media. Route media through authorization checks.
- Validate request size, input shape, owner identity, and revision on the server.
- Back up before imports. Show users what will be imported and require explicit confirmation.

## Validation and release
- Run `node --check` against the frontend script (extract it to a `.cjs` file), `tsc --noEmit`, and SQL migration validation.
- Do not claim Cloudflare, OAuth, email delivery, D1/R2 round-trips, or iPhone PWA behavior are verified unless tested in the deployed environment.
- Keep v8 in its own Cloudflare resources. Never point it at v7 production storage during development.
