-- Local annotations preserve original instruction/evidence rows and canonical changes.
create table public.source_corrections (
  id uuid primary key,
  recorded_order bigint generated always as identity,
  learner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  source_conversation_id uuid not null,
  source_revision text not null,
  instruction_id uuid not null,
  instruction_revision text not null,
  status text not null check(status in ('preview','confirmed','skipped','reopened','undone','superseded')),
  version bigint not null check(version between 1 and 9007199254740991),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=2000000),
  unique(learner_id,request_id),
  foreign key(learner_id,source_conversation_id,source_revision) references public.source_conversations(learner_id,id,source_revision) on delete cascade,
  foreign key(learner_id,instruction_id,source_revision) references public.instructions(learner_id,id,source_revision) on delete cascade
);
alter table public.source_corrections enable row level security;
revoke all on public.source_corrections from public,anon,authenticated;
grant select on public.source_corrections to authenticated;
grant select,insert,update on public.source_corrections to service_role;
grant usage,select on sequence public.source_corrections_recorded_order_seq to service_role;
create policy source_corrections_owner_read on public.source_corrections for select to authenticated using (
  learner_id=auth.uid() and exists(select 1 from public.source_conversations s where s.learner_id=auth.uid() and s.id=source_conversation_id and s.consent_status='confirmed')
  and (payload->'request'->'after'->>'type'<>'newRule' or exists(select 1 from public.source_conversations s where s.learner_id=auth.uid() and s.id::text=payload->'request'->'after'->>'laterSourceConversationId' and s.consent_status='confirmed'))
);
create function private.guard_source_correction() returns trigger language plpgsql security invoker set search_path='' as $$
declare target jsonb; originals jsonb; event jsonb; after_annotation jsonb; change_record public.change_proposals; source_time timestamptz; later_time timestamptz; original_utterances jsonb; expected_withholding boolean; expected_ids jsonb;
begin
  target:=new.payload->'request'->'target';after_annotation:=new.payload->'request'->'after';
  if new.payload->>'id' is distinct from new.id::text or new.payload->>'learnerId' is distinct from new.learner_id::text or new.payload->'request'->>'requestId' is distinct from new.request_id::text or target->>'sourceConversationId' is distinct from new.source_conversation_id::text or target->>'sourceRevision' is distinct from new.source_revision or target->>'instructionId' is distinct from new.instruction_id::text or target->>'instructionRevision' is distinct from new.instruction_revision or new.payload->>'status' is distinct from new.status or new.payload->'version' is distinct from to_jsonb(new.version) then
    raise exception using errcode='23514',message='correction provenance mismatch';
  end if;
  perform private.lock_source_processable(new.learner_id,new.source_conversation_id,new.source_revision);
  if ((target->'instruction') - 'status' - 'updatedAt') is distinct from (private.instruction_snapshot(new.learner_id,new.instruction_id) - 'status' - 'updatedAt') or not exists(select 1 from public.instructions i join public.instruction_revisions r on r.id=i.instruction_revision_id and r.learner_id=i.learner_id where i.id=new.instruction_id and i.learner_id=new.learner_id and i.source_conversation_id=new.source_conversation_id and r.revision=new.instruction_revision) then
    raise exception using errcode='23514',message='correction original instruction mismatch';
  end if;
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',e.id,'sourceConversationId',e.source_conversation_id,'sourceRevision',e.source_revision,'startMs',e.start_ms,'endMs',e.end_ms,'quote',e.quote,'speakerLabel',e.speaker_label,'utteranceIds',e.utterance_ids,'timing',e.timing)) order by l.position) into originals from public.instruction_evidence l join public.source_evidence e on e.id=l.evidence_id and e.learner_id=l.learner_id where l.learner_id=new.learner_id and l.instruction_id=new.instruction_id;
  select jsonb_agg(u order by ordinal) into original_utterances from private.source_materials m cross join lateral jsonb_array_elements(m.utterances) with ordinality as item(u,ordinal) where m.learner_id=new.learner_id and m.source_conversation_id=new.source_conversation_id and exists(select 1 from jsonb_array_elements(originals) e where e->'utteranceIds' ? (u->>'id'));
  if target->'originalUtterances' is distinct from original_utterances then raise exception using errcode='23514',message='correction original speakers/utterances mismatch';end if;
  if target->'sourceEvidence' is distinct from originals then raise exception using errcode='23514',message='correction exact evidence mismatch';end if;
  if jsonb_typeof(new.payload->'reviewHistory') is distinct from 'array' or jsonb_array_length(new.payload->'reviewHistory') not between 1 and 100 or after_annotation->>'type' not in ('attribution','transcription','interpretation','newRule') or length(new.payload->'request'->>'recognizedText') not between 1 and 4000 or new.payload->'request'->>'inputMode' not in ('voice','text') then raise exception using errcode='23514',message='invalid correction review';end if;
  for event in select value from jsonb_array_elements(new.payload->'reviewHistory') loop
    if event->>'learnerId' is distinct from new.learner_id::text or event->>'requestId' is null or event->>'action' not in ('preview','confirm','skip','reopen','undo','supersede') then raise exception using errcode='23514',message='invalid correction chronology';end if;
  end loop;
  if (new.payload->'reviewHistory'->-1->'version') is distinct from to_jsonb(new.version) then raise exception using errcode='23514',message='invalid correction event version';end if;
  if after_annotation->>'type'='newRule' then
    select * into change_record from public.change_proposals c where c.learner_id=new.learner_id and c.id::text=after_annotation->>'changeId' and c.previous_instruction_id=new.instruction_id and c.previous_source_revision=new.source_revision and c.source_revision=after_annotation->>'laterSourceRevision';
    if change_record.id is null or change_record.replacement_snapshot->>'sourceConversationId' is distinct from after_annotation->>'laterSourceConversationId' then raise exception using errcode='23514',message='correction canonical change mismatch';end if;
    perform private.lock_source_processable(new.learner_id,(after_annotation->>'laterSourceConversationId')::uuid,after_annotation->>'laterSourceRevision');
    select started_at into source_time from public.source_conversations where id=new.source_conversation_id and learner_id=new.learner_id;
    select started_at into later_time from public.source_conversations where id=(after_annotation->>'laterSourceConversationId')::uuid and learner_id=new.learner_id;
    if later_time<=source_time or new.status='confirmed' and change_record.status<>'confirmed' then raise exception using errcode='23514',message='correction requires actual later confirmed change';end if;
  end if;
  expected_withholding:=after_annotation->>'type'='transcription' or after_annotation->>'type'='interpretation' and after_annotation->>'meaning'<>'originalInstruction' or after_annotation->>'type'='attribution' and after_annotation->>'preparation'='withhold';
  expected_ids:=case when after_annotation->>'type'='newRule' then jsonb_build_array(new.instruction_id::text,change_record.replacement_instruction_id::text) else jsonb_build_array(new.instruction_id::text) end;
  if new.payload->'effects'->'withholdGrading' is distinct from to_jsonb(expected_withholding) or new.payload->'effects'->'instructionIds' is distinct from expected_ids then raise exception using errcode='23514',message='correction effects must match its exact target';end if;
  if tg_op='INSERT' then
    if target->'instruction' is distinct from private.instruction_snapshot(new.learner_id,new.instruction_id) or target->'instruction'->>'status' is distinct from 'confirmed' then raise exception using errcode='23514',message='correction requires original confirmed instruction';end if;
    if new.status<>'preview' or new.version<>1 or jsonb_array_length(new.payload->'reviewHistory')<>1 or new.payload->'reviewHistory'->0->>'action'<>'preview' then raise exception using errcode='23514',message='correction requires explicit preview';end if;
  else
    if row(new.id,new.learner_id,new.request_id,new.source_conversation_id,new.source_revision,new.instruction_id,new.instruction_revision) is distinct from row(old.id,old.learner_id,old.request_id,old.source_conversation_id,old.source_revision,old.instruction_id,old.instruction_revision) or (new.payload - 'status' - 'version' - 'updatedAt' - 'confirmedBy' - 'confirmedAt' - 'reviewHistory') is distinct from (old.payload - 'status' - 'version' - 'updatedAt' - 'confirmedBy' - 'confirmedAt' - 'reviewHistory') or new.version<>old.version+1 or jsonb_array_length(new.payload->'reviewHistory')<>jsonb_array_length(old.payload->'reviewHistory')+1 or exists(select 1 from jsonb_array_elements(old.payload->'reviewHistory') with ordinality e(value,ordinal) where value is distinct from new.payload->'reviewHistory'->(ordinal::int-1)) then raise exception using errcode='23514',message='correction immutable original or chronology changed';end if;
    event:=new.payload->'reviewHistory'->-1;
    if not ((event->>'action'='confirm' and old.status in ('preview','skipped') and new.status='confirmed') or (event->>'action'='skip' and old.status in ('preview','skipped','reopened') and new.status=case when old.status='reopened' then 'reopened' else 'skipped' end) or (event->>'action'='reopen' and old.status='confirmed' and new.status='reopened') or (event->>'action'='undo' and old.status in ('confirmed','reopened') and new.status='undone') or (event->>'action'='supersede' and old.status='reopened' and new.status='superseded')) then raise exception using errcode='23514',message='invalid correction state transition';end if;
  end if;
  return new;
end;$$;
revoke all on function private.guard_source_correction() from public,anon,authenticated;
create trigger source_corrections_guard before insert or update on public.source_corrections for each row execute function private.guard_source_correction();
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
  foreach table_name in array array['source_conversations','source_materials','instruction_revisions','source_evidence','instructions','instruction_evidence','open_questions','open_question_evidence','extraction_inputs','change_proposals','practice_sets','practice_set_instructions','scenarios','scenario_rules','scenario_evidence','attempts','attempt_rule_results','consent_events','understanding_checks','source_corrections'] loop
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
    if table_name is null or not (table_name = any(array['source_conversations','source_materials','instruction_revisions','source_evidence','instructions','instruction_evidence','open_questions','open_question_evidence','extraction_inputs','change_proposals','practice_sets','practice_set_instructions','scenarios','scenario_rules','scenario_evidence','attempts','attempt_rule_results','understanding_checks','source_corrections'])) then
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

create or replace function private.validate_practice_set_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  progress record;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception using errcode = '23514', message = 'new practice sets must be draft';
    end if;

    perform private.lock_source_processable(
      new.learner_id,
      new.source_conversation_id,
      new.source_revision
    );

    if not exists (
      select 1
      from public.source_conversations source
      where source.learner_id = new.learner_id
        and source.id = new.source_conversation_id
        and source.source_revision = new.source_revision
        and source.source_kind = new.source_kind
        and source.consent_status = 'confirmed'
        and source.status = 'ready'
    ) then
      raise exception using errcode = '23514', message = 'source is not processable';
    end if;
  else
    if row(
      new.id, new.learner_id, new.source_conversation_id, new.source_revision,
      new.source_kind, new.kind, new.instruction_revision_id,
      new.instruction_revision, new.change_proposal_id, new.created_at
    ) is distinct from row(
      old.id, old.learner_id, old.source_conversation_id, old.source_revision,
      old.source_kind, old.kind, old.instruction_revision_id,
      old.instruction_revision, old.change_proposal_id, old.created_at
    ) then
      raise exception using errcode = '23514', message = 'practice-set provenance is immutable';
    end if;

    if new.status is distinct from old.status and not (
      (old.status = 'draft' and new.status = 'ready')
      or (old.status = 'ready' and new.status = 'inProgress')
      or (old.status = 'inProgress' and new.status = 'complete')
      or (
        new.status = 'stale'
        and (
          exists (
            select 1
            from public.source_conversations source
            where source.learner_id = old.learner_id
              and source.consent_status = 'revoked'
              and (
                source.id = old.source_conversation_id
                or exists (
                  select 1
                  from public.practice_set_instructions link
                  join public.instructions instruction
                    on instruction.learner_id = link.learner_id
                   and instruction.id = link.instruction_id
                  where link.learner_id = old.learner_id
                    and link.practice_set_id = old.id
                    and instruction.source_conversation_id = source.id
                )
              )
          )
          or exists (
            select 1 from public.source_corrections c join public.practice_set_instructions link on link.learner_id=c.learner_id and link.practice_set_id=old.id
            where c.learner_id=old.learner_id and c.payload->'effects'->'instructionIds' ? link.instruction_id::text and (c.status='reopened' or c.status='confirmed' and c.payload->'effects'->'withholdGrading'='true'::jsonb)
          )
          or exists (
            select 1
            from public.change_proposals proposal
            join public.practice_set_instructions link
              on link.learner_id = proposal.learner_id
             and link.instruction_id = proposal.previous_instruction_id
            where proposal.learner_id = old.learner_id
              and proposal.id::text = pg_catalog.current_setting(
                'firstday.change_confirmation', true
              )
              and proposal.status = 'confirmed'
              and link.practice_set_id = old.id
          )
        )
      )
    ) then
      raise exception using errcode = '23514', message = 'invalid practice-set state transition';
    end if;
  end if;

  if new.status = 'ready' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.assert_practice_set_ready(new.learner_id, new.id);
  elsif new.status = 'inProgress' and old.status is distinct from new.status then
    if not exists (
      select 1
      from public.attempts attempt
      join public.scenarios scenario
        on scenario.learner_id = attempt.learner_id and scenario.id = attempt.scenario_id
      where scenario.learner_id = new.learner_id and scenario.practice_set_id = new.id
    ) then
      raise exception using errcode = '23514', message = 'in-progress practice requires an attempt';
    end if;
  elsif new.status = 'complete' and old.status is distinct from new.status then
    select * into progress from private.practice_progress(new.learner_id, new.id);
    if progress.total = 0 or progress.completed <> progress.total then
      raise exception using errcode = '23514', message = 'complete practice requires every scenario covered';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := statement_timestamp();
  end if;
  return new;
end;
$$;

-- Direct privileged mutations still obey approved annotation review gates.
create function private.guard_correction_grading() returns trigger language plpgsql security invoker set search_path='' as $$
declare instruction_ids jsonb; rule_id text;
begin
  if tg_table_name='understanding_checks' then instruction_ids:=jsonb_build_array(new.instruction_id::text);
  elsif tg_table_name='attempts' then select jsonb_agg(r.instruction_id::text) into instruction_ids from public.scenario_rules r where r.learner_id=new.learner_id and r.scenario_id=new.scenario_id;
  else
    if new.status in ('draft','stale') then return new;end if;
    select jsonb_agg(r.instruction_id::text) into instruction_ids from public.practice_set_instructions r where r.learner_id=new.learner_id and r.practice_set_id=new.id;
  end if;
  for rule_id in select jsonb_array_elements_text(instruction_ids) loop
    if exists(select 1 from public.source_corrections c where c.learner_id=new.learner_id and c.payload->'effects'->'instructionIds' ? rule_id and (c.status='reopened' or c.status='confirmed' and c.payload->'effects'->'withholdGrading'='true'::jsonb)) then raise exception using errcode='23514',message='source correction requires review before grading';end if;
  end loop;
  return new;
end;$$;
revoke all on function private.guard_correction_grading() from public,anon,authenticated;
create trigger attempts_05_correction_gate before insert on public.attempts for each row execute function private.guard_correction_grading();
create trigger understanding_checks_05_correction_gate before insert or update on public.understanding_checks for each row execute function private.guard_correction_grading();
create trigger practice_sets_05_correction_gate before insert or update on public.practice_sets for each row execute function private.guard_correction_grading();
notify pgrst,'reload schema';
