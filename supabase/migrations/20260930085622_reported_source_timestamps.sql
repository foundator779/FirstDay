-- Preserve reported wall timestamps without fabricating speech durations.
alter table public.source_evidence add column timing jsonb;
alter table public.source_evidence drop constraint source_evidence_range_check;
alter table public.source_evidence drop constraint source_evidence_digest_check;
alter table public.source_evidence add constraint source_evidence_range_check check (
  start_ms >= 0 and end_ms <= 9007199254740991 and (
    case when timing is null then end_ms > start_ms
    else timing = '{"basis":"reportedTimestamps"}'::jsonb and end_ms >= start_ms and end_ms <= 8640000000000000 end
  )
);
-- JSONB's array rendering adds spaces. Serialize individual JSON string elements
-- in order to match the portable factory's compact JSON.stringify ID array.
create function private.reported_utterance_identity(ids jsonb)
returns text language sql immutable strict security invoker set search_path = '' as $$
  select '[' || coalesce(string_agg(value::text, ',' order by ordinal), '') || ']'
  from jsonb_array_elements(ids) with ordinality as item(value, ordinal);
$$;
revoke all on function private.reported_utterance_identity(jsonb) from public, anon, authenticated;
grant execute on function private.reported_utterance_identity(jsonb) to service_role;
alter table public.source_evidence add constraint source_evidence_digest_check check (
  id = 'evd_' || encode(extensions.digest(convert_to(
    source_conversation_id::text || E'\n' || source_revision || E'\n' || start_ms::text || E'\n' || end_ms::text
    || case when timing is null then '' else E'\nreportedTimestamps\n' || private.reported_utterance_identity(utterance_ids) end,
    'UTF8'), 'sha256'), 'hex')
);
-- The service-only commit RPC's column whitelist comes from pg_attribute;
-- it automatically accepts this column. Existing grants/RLS and evidence
-- immutability triggers continue to apply, and load returns the timing JSONB.
notify pgrst, 'reload schema';

-- Bind point provenance to the immutable private source, including coincident IDs.
create function private.guard_reported_evidence()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  source_utterances jsonb;
  selected_ids jsonb;
  first_ms bigint;
  last_ms bigint;
  exact_quote text;
  expected_speaker text;
  speaker_count bigint;
begin
  select m.utterances into source_utterances from private.source_materials m
    where m.learner_id = new.learner_id and m.source_conversation_id = new.source_conversation_id and m.source_revision = new.source_revision;
  if new.timing is null then
    if exists (select 1 from jsonb_array_elements(source_utterances) u where u->'timing' is not null) then
      raise exception using errcode='23514', message='reported source requires reported evidence';
    end if;
    return new;
  end if;
  if source_utterances is null or exists (select 1 from jsonb_array_elements(source_utterances) u where u->'timing'->>'basis' is distinct from 'reportedTimestamp' or u->'startMs' is distinct from u->'endMs') then
    raise exception using errcode='23514', message='invalid reported evidence source';
  end if;
  select jsonb_agg(u->'id' order by ordinal), min((u->>'startMs')::bigint), max((u->>'endMs')::bigint), string_agg(u->>'text', E'\n' order by ordinal),
    min(u->'speaker'->>'label'), count(distinct coalesce(u->'speaker'->>'label', ''))
    into selected_ids, first_ms, last_ms, exact_quote, expected_speaker, speaker_count
    from jsonb_array_elements(source_utterances) with ordinality as item(u, ordinal)
    where new.utterance_ids ? (u->>'id');
  if speaker_count <> 1 then expected_speaker := null; end if;
  if selected_ids is distinct from new.utterance_ids or first_ms is distinct from new.start_ms or last_ms is distinct from new.end_ms or exact_quote is distinct from new.quote or expected_speaker is distinct from new.speaker_label then
    raise exception using errcode='23514', message='reported evidence does not match source selection';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_reported_evidence() from public, anon, authenticated;
create trigger source_evidence_15_reported_selection before insert or update on public.source_evidence for each row execute function private.guard_reported_evidence();
