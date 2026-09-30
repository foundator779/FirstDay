-- Local review revisions of an already confirmed canonical change.
create or replace function private.guard_source_correction() returns trigger language plpgsql security invoker set search_path='' as $$
declare target jsonb; originals jsonb; event jsonb; after_annotation jsonb; change_record public.change_proposals; source_time timestamptz; later_time timestamptz; original_utterances jsonb; expected_withholding boolean; expected_ids jsonb; prior_correction public.source_corrections; canonical_revision boolean:=false;
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
  -- A revision retains the exact historical original and the same actual later
  -- change. It edits only local review wording; canonical policy is never replayed.
  if after_annotation->>'type'='newRule' and new.payload->'request'->>'revisesId' is not null then
    select * into prior_correction from public.source_corrections c where c.learner_id=new.learner_id and c.id::text=new.payload->'request'->>'revisesId';
    if prior_correction.id is null or prior_correction.payload->'request'->'after' is distinct from after_annotation or prior_correction.payload->'request'->'target' is distinct from target then
      raise exception using errcode='23514',message='correction revision must retain canonical provenance';
    end if;
    canonical_revision:=true;
    if tg_op='INSERT' or new.status='confirmed' and new.payload->'reviewHistory'->-1->>'action'='confirm' then
      if change_record.status<>'confirmed' or private.instruction_snapshot(new.learner_id,new.instruction_id)->>'status'<>'changed' or private.instruction_snapshot(new.learner_id,change_record.replacement_instruction_id) is distinct from change_record.replacement_snapshot or change_record.replacement_snapshot->>'status'<>'confirmed' or
        not (prior_correction.status='reopened' or tg_op='UPDATE' and prior_correction.status='superseded' and prior_correction.payload->'reviewHistory'->-1->>'requestId'=new.payload->'reviewHistory'->-1->>'requestId') then
        raise exception using errcode='23514',message='correction revision requires the current confirmed canonical replacement';
      end if;
    end if;
  end if;
  expected_withholding:=after_annotation->>'type'='transcription' or after_annotation->>'type'='interpretation' and after_annotation->>'meaning'<>'originalInstruction' or after_annotation->>'type'='attribution' and after_annotation->>'preparation'='withhold';
  expected_ids:=case when after_annotation->>'type'='newRule' then jsonb_build_array(new.instruction_id::text,change_record.replacement_instruction_id::text) else jsonb_build_array(new.instruction_id::text) end;
  if new.payload->'effects'->'withholdGrading' is distinct from to_jsonb(expected_withholding) or new.payload->'effects'->'instructionIds' is distinct from expected_ids then raise exception using errcode='23514',message='correction effects must match its exact target';end if;
  if tg_op='INSERT' then
    if not canonical_revision and (target->'instruction' is distinct from private.instruction_snapshot(new.learner_id,new.instruction_id) or target->'instruction'->>'status' is distinct from 'confirmed') then raise exception using errcode='23514',message='correction requires original confirmed instruction';end if;
    if new.status<>'preview' or new.version<>1 or jsonb_array_length(new.payload->'reviewHistory')<>1 or new.payload->'reviewHistory'->0->>'action'<>'preview' then raise exception using errcode='23514',message='correction requires explicit preview';end if;
  else
    if row(new.id,new.learner_id,new.request_id,new.source_conversation_id,new.source_revision,new.instruction_id,new.instruction_revision) is distinct from row(old.id,old.learner_id,old.request_id,old.source_conversation_id,old.source_revision,old.instruction_id,old.instruction_revision) or (new.payload - 'status' - 'version' - 'updatedAt' - 'confirmedBy' - 'confirmedAt' - 'reviewHistory') is distinct from (old.payload - 'status' - 'version' - 'updatedAt' - 'confirmedBy' - 'confirmedAt' - 'reviewHistory') or new.version<>old.version+1 or jsonb_array_length(new.payload->'reviewHistory')<>jsonb_array_length(old.payload->'reviewHistory')+1 or exists(select 1 from jsonb_array_elements(old.payload->'reviewHistory') with ordinality e(value,ordinal) where value is distinct from new.payload->'reviewHistory'->(ordinal::int-1)) then raise exception using errcode='23514',message='correction immutable original or chronology changed';end if;
    event:=new.payload->'reviewHistory'->-1;
    if not ((event->>'action'='confirm' and old.status in ('preview','skipped') and new.status='confirmed') or (event->>'action'='skip' and old.status in ('preview','skipped','reopened') and new.status=case when old.status='reopened' then 'reopened' else 'skipped' end) or (event->>'action'='reopen' and old.status='confirmed' and new.status='reopened') or (event->>'action'='undo' and old.status in ('confirmed','reopened') and new.status='undone') or (event->>'action'='supersede' and old.status='reopened' and new.status='superseded')) then raise exception using errcode='23514',message='invalid correction state transition';end if;
  end if;
  return new;
end;$$;
revoke all on function private.guard_source_correction() from public,anon,authenticated;

notify pgrst, 'reload schema';
