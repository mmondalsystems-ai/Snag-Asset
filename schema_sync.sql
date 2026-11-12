-- ============================================================
-- SNAG CHECK - sheet mirror support
--   * change events  : every web/app write is logged to snag_sync_events
--   * pg_net webhook : pings the Apps Script web app so the sheet updates in 3-5 s
--   * pull RPC       : snag_events_since()  (Apps Script reads changes)
--   * push RPCs      : snag_push_preview / snag_push_rows / snag_push_finish
--                      (manual "overwrite Supabase from this sheet tab")
-- Run AFTER schema.sql.
-- ============================================================

-- On Supabase pg_net is available. (Dashboard > Database > Extensions if this fails.)
create extension if not exists pg_net;

create table if not exists snag_sync_events (
  id  bigint generated always as identity primary key,
  tbl text not null,
  pk  text not null,
  op  text not null,                 -- I / U / D
  at  timestamptz not null default now()
);
alter table snag_sync_events enable row level security;

create table if not exists snag_sync_settings (
  key   text primary key,
  value text
);
alter table snag_sync_settings enable row level security;

-- ---------- which column is the primary key of each table ----------
create or replace function snag_pk_col(p_table text) returns text
language sql immutable as $$
  select case p_table
    when 'app_users'         then 'userId'
    when 'flats'             then 'flatId'
    when 'snag_master'       then 'snagId'
    when 'asset_master'      then 'assetId'
    when 'inspections'       then 'rowId'
    when 'asset_inspections' then 'rowId'
    when 'photos'            then 'photoId'
    when 'activity_log'      then 'logId'
    when 'snag_overrides'    then 'overrideId'
  end
$$;

-- ---------- row trigger: log a change event ----------
create or replace function snag_log_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pk text;
begin
  -- bulk loads / sheet pushes set this flag so they do not echo back to the sheet
  if coalesce(current_setting('snag.skip_events', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_pk := to_jsonb(old) ->> tg_argv[0];
    insert into snag_sync_events (tbl, pk, op) values (tg_table_name, v_pk, 'D');
  else
    v_pk := to_jsonb(new) ->> tg_argv[0];
    insert into snag_sync_events (tbl, pk, op)
    values (tg_table_name, v_pk, case tg_op when 'INSERT' then 'I' else 'U' end);
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['app_users','flats','snag_master','asset_master','inspections',
                           'asset_inspections','photos','activity_log','snag_overrides']
  loop
    execute format('drop trigger if exists %I on %I', t || '_ev_id', t);
    execute format('drop trigger if exists %I on %I', t || '_ev_u',  t);
    execute format('create trigger %I after insert or delete on %I for each row execute function snag_log_event(%L)',
                   t || '_ev_id', t, snag_pk_col(t));
    execute format('create trigger %I after update on %I for each row when (old.* is distinct from new.*) execute function snag_log_event(%L)',
                   t || '_ev_u', t, snag_pk_col(t));
  end loop;
end $$;

-- ---------- statement trigger: ping the Apps Script web app (empty body) ----------
create or replace function snag_ping_webhook() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  select value into v_url from snag_sync_settings where key = 'webhook_url';
  if v_url is not null and v_url <> '' then
    begin
      perform net.http_post(url := v_url, body := '{}'::jsonb,
                            headers := '{"Content-Type":"application/json"}'::jsonb,
                            timeout_milliseconds := 5000);
    exception when others then
      null;   -- never block a save because of the webhook
    end;
  end if;
  return null;
end $$;

drop trigger if exists snag_sync_events_ping on snag_sync_events;
create trigger snag_sync_events_ping after insert on snag_sync_events
  for each statement execute function snag_ping_webhook();

-- ---------- PULL: changes since an event id, with the current row ----------
create or replace function snag_events_since(p_after bigint, p_limit int default 500)
returns table (id bigint, tbl text, pk text, op text, data jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.tbl, e.pk, e.op,
    case when e.op = 'D' then null else
      case e.tbl
        when 'app_users'         then (select to_jsonb(t) - '_seq' from app_users t         where t."userId"     = e.pk)
        when 'flats'             then (select to_jsonb(t) - '_seq' from flats t             where t."flatId"     = e.pk)
        when 'snag_master'       then (select to_jsonb(t) - '_seq' from snag_master t       where t."snagId"     = e.pk)
        when 'asset_master'      then (select to_jsonb(t) - '_seq' from asset_master t      where t."assetId"    = e.pk)
        when 'inspections'       then (select to_jsonb(t) - '_seq' from inspections t       where t."rowId"      = e.pk)
        when 'asset_inspections' then (select to_jsonb(t) - '_seq' from asset_inspections t where t."rowId"      = e.pk)
        when 'photos'            then (select to_jsonb(t) - '_seq' from photos t            where t."photoId"    = e.pk)
        when 'activity_log'      then (select to_jsonb(t) - '_seq' from activity_log t      where t."logId"      = e.pk)
        when 'snag_overrides'    then (select to_jsonb(t) - '_seq' from snag_overrides t    where t."overrideId" = e.pk)
      end
    end as data
  from (select * from snag_sync_events s where s.id > p_after order by s.id limit p_limit) e
  order by e.id
$$;

create or replace function snag_events_max() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(max(id), 0) from snag_sync_events
$$;

create or replace function snag_prune_events(p_days int default 7) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from snag_sync_events where at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- PUSH (sheet tab -> Supabase, overwrite) ----------
-- 1) preview: what would change?
create or replace function snag_push_preview(p_table text, p_keys text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pk text := snag_pk_col(p_table); n_db int; n_del int; n_upd int;
begin
  if pk is null then raise exception 'Unknown table %', p_table; end if;
  execute format('select count(*) from %I', p_table) into n_db;
  execute format('select count(*) from %I where %I <> all ($1)', p_table, pk) using p_keys into n_del;
  execute format('select count(*) from %I where %I = any ($1)',  p_table, pk) using p_keys into n_upd;
  return jsonb_build_object('db_rows', n_db, 'sheet_rows', coalesce(array_length(p_keys, 1), 0),
                            'to_delete', n_del, 'to_update', n_upd,
                            'to_insert', coalesce(array_length(p_keys, 1), 0) - n_upd);
end $$;

-- 2) upsert a chunk of rows (types are cast by jsonb_populate_recordset)
create or replace function snag_push_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare pk text := snag_pk_col(p_table); cols text; sets text; n int;
begin
  if pk is null then raise exception 'Unknown table %', p_table; end if;
  perform set_config('snag.skip_events', 'on', true);
  select string_agg(format('%I', column_name), ',' order by ordinal_position),
         string_agg(format('%I = excluded.%I', column_name, column_name), ',' order by ordinal_position)
           filter (where column_name <> pk)
    into cols, sets
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table and column_name <> '_seq';
  execute format(
    'insert into %1$I (%2$s) select %2$s from jsonb_populate_recordset(null::%1$I, $1) with ordinality as r order by ordinality '
    'on conflict (%3$I) do update set %4$s', p_table, cols, pk, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

-- 3) delete rows that are not in the sheet (refuses an empty sheet)
create or replace function snag_push_finish(p_table text, p_keys text[]) returns int
language plpgsql security definer set search_path = public as $$
declare pk text := snag_pk_col(p_table); n int;
begin
  if pk is null then raise exception 'Unknown table %', p_table; end if;
  if p_keys is null or coalesce(array_length(p_keys, 1), 0) = 0 then
    raise exception 'Sheet has no rows - refusing to delete everything';
  end if;
  perform set_config('snag.skip_events', 'on', true);
  execute format('delete from %I where %I <> all ($1)', p_table, pk) using p_keys;
  get diagnostics n = row_count;
  return n;
end $$;

-- only the server key (service_role) may call these
revoke all on function snag_events_since(bigint, int)   from public, anon, authenticated;
revoke all on function snag_events_max()                from public, anon, authenticated;
revoke all on function snag_prune_events(int)           from public, anon, authenticated;
revoke all on function snag_push_preview(text, text[])  from public, anon, authenticated;
revoke all on function snag_push_rows(text, jsonb)      from public, anon, authenticated;
revoke all on function snag_push_finish(text, text[])   from public, anon, authenticated;
grant execute on function snag_events_since(bigint, int)  to service_role;
grant execute on function snag_events_max()               to service_role;
grant execute on function snag_prune_events(int)          to service_role;
grant execute on function snag_push_preview(text, text[]) to service_role;
grant execute on function snag_push_rows(text, jsonb)     to service_role;
grant execute on function snag_push_finish(text, text[])  to service_role;

-- AFTER the Apps Script web app is deployed, store its URL (with ?token=...) once:
--   insert into snag_sync_settings (key, value)
--   values ('webhook_url', 'https://script.google.com/macros/s/XXXX/exec?token=YYYY')
--   on conflict (key) do update set value = excluded.value;

notify pgrst, 'reload schema';
