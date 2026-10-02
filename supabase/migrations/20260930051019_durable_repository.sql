-- Internal serialization/versioning; application records remain normalized.
grant usage on schema extensions to service_role;
create table private.repository_versions (
  learner_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0 check (version >= 0)
);
alter table private.repository_versions enable row level security;
revoke all on private.repository_versions from public, anon, authenticated;
grant select, insert, update on private.repository_versions to service_role;

-- Preserve transaction order even when multiple attempts have identical clocks.
alter table public.attempts add column recorded_order bigint generated always as identity;
alter table public.practice_sets add column recorded_order bigint generated always as identity;
grant usage, select on sequence public.attempts_recorded_order_seq to service_role;
grant usage, select on sequence public.practice_sets_recorded_order_seq to service_role;
alter table private.source_materials enable row level security;
alter table private.extraction_inputs enable row level security;
alter table private.consent_events enable row level security;

create function private.instruction_snapshot(p_learner_id uuid, p_instruction_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', i.id, 'sourceConversationId', i.source_conversation_id, 'sourceRevision', i.source_revision,
    'text', i.text, 'situation', i.situation, 'expectedAction', i.expected_action, 'exceptions', i.exceptions,
    'confidence', i.confidence, 'status', i.status, 'supersedesId', i.supersedes_id,
    'createdAt', to_char(i.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(i.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceEvidence', (select jsonb_agg(e.evidence_id order by e.position) from public.instruction_evidence e where e.learner_id = i.learner_id and e.instruction_id = i.id)
  )) from public.instructions i where i.learner_id = p_learner_id and i.id = p_instruction_id;
$$;
revoke all on function private.instruction_snapshot(uuid,uuid) from public, anon, authenticated;
grant execute on function private.instruction_snapshot(uuid,uuid) to service_role;

alter table public.change_proposals add column replacement_snapshot jsonb;
do $$
begin
  -- Backfill only the new field; retain every existing state and identity.
  alter table public.change_proposals disable trigger change_proposals_10_validate;
  update public.change_proposals p set replacement_snapshot = private.instruction_snapshot(p.learner_id, p.replacement_instruction_id) || jsonb_build_object('status', p.status);
  alter table public.change_proposals enable trigger change_proposals_10_validate;
end;
$$;
alter table public.change_proposals alter column replacement_snapshot set not null;
alter table public.change_proposals add constraint change_proposals_snapshot_check check (jsonb_typeof(replacement_snapshot) = 'object' and octet_length(replacement_snapshot::text) <= 200000);

create function private.preserve_change_snapshot()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare current_snapshot jsonb;
begin
  current_snapshot := private.instruction_snapshot(new.learner_id, new.replacement_instruction_id);
  if tg_op = 'INSERT' then
    if new.replacement_snapshot is not null and new.replacement_snapshot is distinct from current_snapshot then
      raise exception using errcode = '23514', message = 'proposal snapshot must match the reviewed replacement';
    end if;
    new.replacement_snapshot := current_snapshot;
  else
    if new.replacement_snapshot is distinct from old.replacement_snapshot then
      raise exception using errcode = '23514', message = 'proposal review snapshot is immutable';
    end if;
    if new.status is distinct from old.status then
      if (current_snapshot - 'status' - 'updatedAt') is distinct from (old.replacement_snapshot - 'status' - 'updatedAt') then
        raise exception using errcode = '23514', message = 'replacement changed after proposal review';
      end if;
      new.replacement_snapshot := current_snapshot;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.preserve_change_snapshot() from public, anon, authenticated;
create trigger change_proposals_20_snapshot before insert or update on public.change_proposals for each row execute function private.preserve_change_snapshot();

create function public.firstday_repository_load(p_learner_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  table_name text;
  schema_name text;
  records jsonb := '{}'::jsonb;
  rows jsonb;
  version bigint;
begin
  if p_learner_id is null then
    raise exception using errcode = '23514', message = 'invalid repository owner';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_learner_id::text, 83492));
  select v.version into version from private.repository_versions v where learner_id = p_learner_id;
  foreach table_name in array array['source_conversations','source_materials','instruction_revisions','source_evidence','instructions','instruction_evidence','open_questions','open_question_evidence','extraction_inputs','change_proposals','practice_sets','practice_set_instructions','scenarios','scenario_rules','scenario_evidence','attempts','attempt_rule_results','consent_events'] loop
    schema_name := case when table_name in ('source_materials','extraction_inputs','consent_events') then 'private' else 'public' end;
    execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from %I.%I r where learner_id = $1', schema_name, table_name) into rows using p_learner_id;
    records := records || jsonb_build_object(table_name, rows);
  end loop;
  return jsonb_build_object('version', coalesce(version, 0), 'records', records);
end;
$$;

create function public.firstday_repository_commit(p_learner_id uuid, p_expected_version bigint, p_commands jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  current_version bigint;
  command jsonb;
  row_data jsonb;
  operation text;
  table_name text;
  schema_name text;
  relation regclass;
  columns_sql text;
  values_sql text;
  predicate_sql text;
  primary_columns text[];
  affected bigint;
begin
  if p_learner_id is null or p_expected_version is null or p_expected_version < 0
    or p_expected_version >= 9007199254740991 or p_commands is null or jsonb_typeof(p_commands) <> 'array'
    or jsonb_array_length(p_commands) > 5000 or octet_length(p_commands::text) > 16000000 then
    raise exception using errcode = '23514', message = 'invalid repository transaction';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_learner_id::text, 83492));
  insert into private.repository_versions (learner_id) values (p_learner_id) on conflict do nothing;
  select version into current_version from private.repository_versions where learner_id = p_learner_id for update;
  if current_version <> p_expected_version then return false; end if;
  for command in select value from jsonb_array_elements(p_commands) loop
    operation := command->>'kind';
    if operation = 'confirmChange' then
      perform private.confirm_change(p_learner_id, (command->>'id')::uuid);
      continue;
    elsif operation = 'revokeConsent' then
      perform private.revoke_source_consent(p_learner_id, (command->>'id')::uuid, command->>'sourceRevision', command->>'reason');
      continue;
    end if;
    table_name := command->>'table';
    if table_name is null or not (table_name = any(array['source_conversations','source_materials','instruction_revisions','source_evidence','instructions','instruction_evidence','open_questions','open_question_evidence','extraction_inputs','change_proposals','practice_sets','practice_set_instructions','scenarios','scenario_rules','scenario_evidence','attempts','attempt_rule_results'])) then
      raise exception using errcode = '23514', message = 'invalid repository table';
    end if;
    schema_name := case when table_name in ('source_materials','extraction_inputs') then 'private' else 'public' end;
    relation := format('%I.%I', schema_name, table_name)::regclass;
    row_data := command->'row';
    if row_data is null or jsonb_typeof(row_data) <> 'object' or (row_data->>'learner_id')::uuid is distinct from p_learner_id then
      raise exception using errcode = '23514', message = 'invalid repository owner';
    end if;
    if exists (select 1 from jsonb_object_keys(row_data) field where not exists (
      select 1 from pg_catalog.pg_attribute a where a.attrelid = relation and a.attname = field and a.attnum > 0 and not a.attisdropped and a.attidentity = ''
    )) then raise exception using errcode = '23514', message = 'invalid repository column'; end if;
    select array_agg(a.attname order by a.attnum) into primary_columns
      from pg_catalog.pg_index i join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = relation and i.indisprimary;
    if exists (select 1 from unnest(primary_columns) field where row_data->>field is null) then
      raise exception using errcode = '23514', message = 'missing repository key';
    end if;
    select string_agg(format('to_jsonb(existing)->>%L = $1->>%L', field, field), ' and ') into predicate_sql from unnest(primary_columns) field;
    if operation = 'delete' then
      if table_name not in ('instruction_evidence','open_question_evidence') then
        raise exception using errcode = '23514', message = 'repository deletion must use controlled operations';
      end if;
      execute format('delete from %I.%I existing where learner_id = $2 and %s', schema_name, table_name, predicate_sql) using row_data, p_learner_id;
    elsif operation in ('insert', 'update') then
      select string_agg(format('%I', field), ',' order by field), string_agg(format('(jsonb_populate_record(null::%I.%I, $1)).%I', schema_name, table_name, field), ',' order by field)
        into columns_sql, values_sql from jsonb_object_keys(row_data) field
        where operation = 'insert' or not (field = any(primary_columns));
      if columns_sql is null then raise exception using errcode = '23514', message = 'empty repository write'; end if;
      if operation = 'insert' then
        execute format('insert into %I.%I (%s) select %s', schema_name, table_name, columns_sql, values_sql) using row_data;
      else
        execute format('update %I.%I existing set (%s) = (select %s) where learner_id = $2 and %s', schema_name, table_name, columns_sql, values_sql, predicate_sql) using row_data, p_learner_id;
      end if;
    else raise exception using errcode = '23514', message = 'invalid repository operation'; end if;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception using errcode = '23514', message = 'repository record changed'; end if;
  end loop;
  update private.repository_versions set version = version + 1 where learner_id = p_learner_id;
  return true;
end;
$$;

revoke all on function public.firstday_repository_load(uuid) from public, anon, authenticated;
revoke all on function public.firstday_repository_commit(uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.firstday_repository_load(uuid) to service_role;
grant execute on function public.firstday_repository_commit(uuid,bigint,jsonb) to service_role;
notify pgrst, 'reload schema';
