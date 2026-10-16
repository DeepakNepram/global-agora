-- Reports and blocks (Prompt 4.3): the reader's own tools.
--
-- Reports: one per reader and post, on a post you can see that is not your
-- own, for one of six reasons. 4.2 kept the table readable by the service
-- role only (a restrictive deny), so a definer function writes them and
-- nobody reads them back but moderators (20261017130000). The reporter
-- hears the outcome as a notification.
--
-- Blocks: "hides that user's content everywhere, both directions". A block
-- needs a profile, not agreed rules or a clean record: safety tools are
-- always available, suspended or not. Unblocking is allowed.

-- ---------------------------------------------------------------------------
-- Blocks, both ways.
-- ---------------------------------------------------------------------------

-- Everyone hidden from the caller, and from whom the caller is hidden.
-- Definer: a reader sees only the blocks they made, but a block against
-- them must hide them too.
create function private.blocked_either_way()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id from public.blocks b where b.blocker_id = auth.uid()
  union
  select b.blocker_id from public.blocks b where b.blocked_id = auth.uid();
$$;

revoke all on function private.blocked_either_way() from public, anon, authenticated;
grant execute on function private.blocked_either_way() to authenticated;

-- Votes and reports need a post you can see, so they follow this too. The
-- subquery runs once per query (a hashed subplan), not once per post.
drop policy "posts: approved and not blocked, or your own" on public.posts;
create policy "posts: approved, no block either way, or your own"
  on public.posts for select to authenticated
  using (
    author_id = (select auth.uid())
    or (mod_state = 'ok' and author_id not in (select private.blocked_either_way()))
  );

alter table public.blocks
  alter column blocker_id set default auth.uid(),
  add column created_at timestamptz not null default now();

grant insert (blocked_id) on public.blocks to authenticated;
grant delete on public.blocks to authenticated;

create policy "blocks: block from your account"
  on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));

create policy "blocks: unblock"
  on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Reports.
-- ---------------------------------------------------------------------------
alter table public.reports
  add constraint reports_reason_known
    check (reason in ('harassment', 'hate', 'threat', 'spam', 'false_expertise', 'off_topic')),
  add constraint reports_once_per_reader unique (post_id, reporter_id),
  -- When and by whom it was dealt with (20261017130000); 4.6 counts the
  -- median time to action from these.
  add column resolved_at timestamptz,
  add column resolved_by uuid references public.profiles (id) on delete set null;

create function public.report_post(p_post uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_state text;
begin
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'sign in to report' using errcode = '42501';
  end if;
  select p.author_id, p.mod_state into v_author, v_state from public.posts p where p.id = p_post;
  -- Only what you can see and is not yours: the same rule as reading.
  if not found or v_state <> 'ok' or v_author = v_uid
     or v_author in (select private.blocked_either_way()) then
    raise exception 'no such post' using errcode = 'P0002';
  end if;
  -- Unknown reasons fail the CHECK (23514); a second report the unique
  -- constraint (23505).
  insert into public.reports (post_id, reporter_id, reason) values (p_post, v_uid, p_reason);
end;
$$;

revoke all on function public.report_post(uuid, text) from public, anon, authenticated;
grant execute on function public.report_post(uuid, text) to authenticated;
