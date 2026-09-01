create table public.generated_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_url text not null,
  object_key text not null unique,
  prompt text not null,
  provider text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create index generated_images_user_created_idx
  on public.generated_images (user_id, created_at desc);

alter table public.generated_images enable row level security;

create policy "Users can insert their own generated images"
  on public.generated_images for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can view their own generated images"
  on public.generated_images for select to authenticated
  using ((select auth.uid()) = user_id);
