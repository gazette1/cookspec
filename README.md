# CookSpec

Domain: cookspec.xyz

Paste a link to a TikTok, Reel, Short, or article, or upload a photo, and get the recipe back as one tabular card: ingredients down the left, operations merging column by column into the finished dish. The notation comes from Michael Chu's Cooking for Engineers (cookingforengineers.com).

Status: scaffold. The layout engine and card renderer work against a fixture recipe; the extraction pipeline is not wired yet.

## Stack
- Next.js on Cloudflare Workers via @opennextjs/cloudflare
- Supabase: Postgres, Auth, Storage (schema in supabase/migrations, cloud project not yet provisioned)
- Planned pipeline: managed scraper API for media fetch, Gemini for vision and audio transcription, DeepSeek and Kimi for structuring, unit validation against a density table, web research pass for gaps

## Commands
- `npm run dev` local dev server
- `npm run build` production build
- `npm run preview` build and serve through the Cloudflare workerd runtime
- `npm run deploy` deploy to Cloudflare (needs wrangler auth)

## Deploys from GitHub
Pushes to main run .github/workflows/deploy.yml, which builds the worker and deploys it to Cloudflare. The workflow skips (green, no deploy) until these repository secrets exist under Settings, Secrets and variables, Actions: CLOUDFLARE_API_TOKEN (create in the Cloudflare dashboard with the Edit Workers template), CLOUDFLARE_ACCOUNT_ID, DEEPSEEK_API_KEY, GEMINI_API_KEY, MOONSHOT_API_KEY, SCRAPER_API_TOKEN, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY.

## Where decisions live
Product decisions, architecture, and phases live in the vault note "Cooking Instructions". Session logs live in the vault Daily Notes.
