-- ============================================================
-- SNAG CHECK - Supabase (PostgreSQL) schema
-- Column names are the SAME camelCase headers as the Google Sheet,
-- so JSON returned to the page has exactly the same keys as before.
-- "_seq" keeps the original sheet row order (insertion order).
-- Run this FIRST in the Supabase SQL Editor.
-- ============================================================

create table if not exists app_users (
  "_seq"     bigint generated always as identity,
  "userId"   text primary key,
  "username" text,
  "pin"      text,
  "role"     text
);

create table if not exists flats (
  "_seq"     bigint generated always as identity,
  "flatId"   text primary key,
  "tower"    text,
  "floor"    integer,
  "flatNo"   text,
  "flatType" text
);

create table if not exists snag_master (
  "_seq"           bigint generated always as identity,
  "snagId"         text primary key,
  "location"       text,
  "snagPoint"      text,
  "respContractor" text,
  "checkingArea"   text,
  "respName"       text
);

create table if not exists asset_master (
  "_seq"        bigint generated always as identity,
  "assetId"     text primary key,
  "assetType"   text,
  "location"    text,
  "assetPoint"  text,
  "numbers"     double precision,
  "respPerson"  text
);

-- NOTE: no unique (flatId, snagId) on purpose. The old sheet already contains
-- duplicate pairs and Code.gs always updated the FIRST matching row.
create table if not exists inspections (
  "_seq"           bigint generated always as identity,
  "rowId"          text primary key,
  "flatId"         text,
  "snagId"         text,
  "status"         text,
  "r1SnagRemark"   text,
  "r1DeSnagRemark" text,
  "r2SnagRemark"   text,
  "r2DeSnagRemark" text
);

create table if not exists asset_inspections (
  "_seq"           bigint generated always as identity,
  "rowId"          text primary key,
  "flatId"         text,
  "assetId"        text,
  "status"         text,
  "r1SnagRemark"   text,
  "r1DeSnagRemark" text,
  "r2SnagRemark"   text,
  "r2DeSnagRemark" text
);

create table if not exists photos (
  "_seq"       bigint generated always as identity,
  "photoId"    text primary key,
  "flatId"     text,
  "refId"      text,
  "round"      text,
  "section"    text,
  "fileId"     text,
  "viewUrl"    text,
  "thumbUrl"   text,
  "uploadedBy" text,
  "timestamp"  timestamptz default now()
);

create table if not exists activity_log (
  "_seq"         bigint generated always as identity,
  "logId"        text primary key,
  "tower"        text,
  "floor"        text,
  "flatNo"       text,
  "flatType"     text,
  "section"      text,
  "location"     text,
  "pointLabel"   text,
  "columnHeader" text,
  "oldVal"       text,
  "newVal"       text,
  "changedBy"    text,
  "timestamp"    timestamptz default now()
);

create table if not exists snag_overrides (
  "_seq"       bigint generated always as identity,
  "overrideId" text primary key,
  "flatId"     text,
  "refId"      text,
  "section"    text,
  "field"      text,
  "value"      text
);

create index if not exists inspections_flat_idx       on inspections ("flatId", "snagId");
create index if not exists asset_inspections_flat_idx on asset_inspections ("flatId", "assetId");
create index if not exists photos_flat_idx            on photos ("flatId");
create index if not exists overrides_flat_idx         on snag_overrides ("flatId");
create index if not exists activity_log_flat_idx      on activity_log ("tower", "flatNo");
create index if not exists flats_tower_idx            on flats ("tower", "floor");

-- Server-side access only (the app uses the DB connection, not the Supabase client keys)
alter table app_users          enable row level security;
alter table flats              enable row level security;
alter table snag_master        enable row level security;
alter table asset_master       enable row level security;
alter table inspections        enable row level security;
alter table asset_inspections  enable row level security;
alter table photos             enable row level security;
alter table activity_log       enable row level security;
alter table snag_overrides     enable row level security;

notify pgrst, 'reload schema';
