-- Interim policies for the pre-auth converter: anonymous conversions persist
-- as ownerless public recipes and log usage events. Tighten before launch
-- (rate limiting plus authenticated ownership).

create policy "recipes anon insert public" on public.recipes
  for insert with check (owner_id is null and is_public);

create policy "conversion events anyone insert" on public.conversion_events
  for insert with check (true);
