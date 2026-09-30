-- Learner-owned intended-action dialogues; no raw audio or permanent voice identity.
create table public.understanding_checks (
  id uuid primary key,
  learner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  source_conversation_id uuid not null,
  source_revision text not null,
  instruction_id uuid not null,
  instruction_revision text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000000),
  unique (learner_id,request_id),
  foreign key (learner_id,source_conversation_id,source_revision) references public.source_conversations(learner_id,id,source_revision) on delete cascade,
  foreign key (learner_id,instruction_id,source_revision) references public.instructions(learner_id,id,source_revision) on delete cascade
);
alter table public.understanding_checks enable row level security;
revoke all on public.understanding_checks from public, anon, authenticated;
grant select on public.understanding_checks to authenticated;
grant select, insert, update on public.understanding_checks to service_role;
create policy understanding_checks_owner_read on public.understanding_checks for select to authenticated using (learner_id = auth.uid() and exists (select 1 from public.source_conversations s where s.id = source_conversation_id and s.learner_id = auth.uid() and s.consent_status = 'confirmed'));

create or replace function private.guard_understanding_check()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(new.payload->'version') is distinct from 'number' or (new.payload->>'version')::bigint < 1 or (new.payload->>'version')::bigint > 9007199254740991 then
    raise exception using errcode='23514',message='invalid understanding version';
  end if;
  if new.payload->'instruction' is distinct from private.instruction_snapshot(new.learner_id,new.instruction_id) then
    raise exception using errcode='23514',message='understanding instruction mismatch';
  end if;
  if not exists (select 1 from public.instructions i join public.source_conversations s on s.id=i.source_conversation_id and s.learner_id=i.learner_id where i.id=new.instruction_id and i.learner_id=new.learner_id and i.source_conversation_id=new.source_conversation_id and i.source_revision=new.source_revision and i.status='confirmed' and s.consent_status='confirmed' and exists(select 1 from public.instruction_revisions r where r.id=i.instruction_revision_id and r.learner_id=i.learner_id and r.revision=new.instruction_revision)) then
    raise exception using errcode='23514',message='understanding source unavailable';
  end if;
  if new.payload->>'id' is distinct from new.id::text or new.payload->>'requestId' is distinct from new.request_id::text or new.payload->>'instructionRevision' is distinct from new.instruction_revision or new.payload->'instruction'->>'id' is distinct from new.instruction_id::text or new.payload->'instruction'->>'sourceConversationId' is distinct from new.source_conversation_id::text or new.payload->'instruction'->>'sourceRevision' is distinct from new.source_revision then
    raise exception using errcode='23514',message='understanding provenance mismatch';
  end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.learner_id is distinct from old.learner_id or new.request_id is distinct from old.request_id or new.instruction_id is distinct from old.instruction_id or new.source_conversation_id is distinct from old.source_conversation_id or new.source_revision is distinct from old.source_revision or new.instruction_revision is distinct from old.instruction_revision or (new.payload - 'status' - 'applicability' - 'responses' - 'updatedAt' - 'version' - 'reviewHistory') is distinct from (old.payload - 'status' - 'applicability' - 'responses' - 'updatedAt' - 'version' - 'reviewHistory') or (new.payload->>'version')::bigint <> (old.payload->>'version')::bigint+1) then
    raise exception using errcode='23514',message='understanding snapshot immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_understanding_check() from public, anon, authenticated;
create trigger understanding_checks_guard before insert or update on public.understanding_checks for each row execute function private.guard_understanding_check();

create or replace function public.firstday_repository_load(p_learner_id uuid)
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
  foreach table_name in array array['source_conversations','source_materials','instruction_revisions','source_evidence','instructions','instruction_evidence','open_questions','open_question_evidence','extraction_inputs','change_proposals','practice_sets','practice_set_instructions','scenarios','scenario_rules','scenario_evidence','attempts','attempt_rule_results','consent_events','understanding_checks'] loop
    schema_name := case when table_name in ('source_materials','extraction_inputs','consent_events') then 'private' else 'public' end;
    execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from %I.%I r where learner_id = $1', schema_name, table_name) into rows using p_learner_id;
    records := records || jsonb_build_object(table_name, rows);
  end loop;
  return jsonb_build_object('version', coalesce(version, 0), 'records', records);
end;
$$;

create or replace function public.firstday_repository_commit(p_learner_id uuid, p_expected_version bigint, p_commands jsonb)
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
    if table_name is null or not (table_name = any(array['source_conversations','source_materials','instruction_revisions','source_evidence','instructions','instruction_evidence','open_questions','open_question_evidence','extraction_inputs','change_proposals','practice_sets','practice_set_instructions','scenarios','scenario_rules','scenario_evidence','attempts','attempt_rule_results','understanding_checks'])) then
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
