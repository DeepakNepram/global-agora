-- Prompt 4.4: the local badge. A post may carry a coarse text label such as
-- "Bengaluru area, India", derived by the API Worker from Cloudflare's IP data
-- for that one request, and only when its author turned the badge on for that
-- post (CLAUDE.md #5: no GPS, no coordinates, nothing else captured).
--
-- The app posts through the Worker, which forwards the insert to PostgREST
-- with the reader's own token: every policy, limit and trigger applies as to
-- any post. To attach a label it adds two headers, the label (base64, since a
-- city's name is not header-safe) and a secret shared with this database
-- through Vault. Without the secret no label can be written; clients hold no
-- grant on the column at all (4.2), so a post sent straight to the database
-- simply has none.
--
-- The label never reaches ranking (rank_score is generated from the vote
-- counts alone) or the moderation services (they get the post id and body).

-- What a label may look like: "<city> area" or "<city> area, <country>", one
-- line, and no decimal numbers, so never a coordinate. 64 characters stays
-- the cap (4.2).
alter table public.posts
  add constraint posts_region_label_shape check (
    region_label ~ '^[^[:cntrl:]]+ area(, [^[:cntrl:]]+)?$'
    and region_label !~ '[0-9][.,][0-9]'
  );

-- PostgREST puts each request's headers, names lower-cased, into
-- request.headers; any other caller has none, and its post goes unlabelled.
create function private.posts_region_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_label text := v_headers ->> 'x-region-label';
  v_given text := v_headers ->> 'x-region-label-secret';
  v_secret text;
begin
  if v_label is null then
    return new;
  end if;
  select s.decrypted_secret into v_secret
    from vault.decrypted_secrets s where s.name = 'region_label_secret';
  -- Digests, so the comparison takes the same time however much matches.
  -- No Vault entry refuses every label: fail closed.
  if v_secret is null or v_given is null
     or extensions.digest(v_given, 'sha256') <> extensions.digest(v_secret, 'sha256') then
    raise exception 'A region label can only come from the API Worker.'
      using errcode = '42501';
  end if;
  begin
    new.region_label := convert_from(decode(v_label, 'base64'), 'UTF8');
  exception when others then
    raise exception 'The region label is not base64-encoded UTF-8.' using errcode = '22023';
  end;
  return new;
end;
$$;

revoke all on function private.posts_region_label() from public, anon, authenticated;

create trigger posts_region_label before insert on public.posts
  for each row execute function private.posts_region_label();
