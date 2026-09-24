create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create function private.is_text_array(
  value jsonb,
  minimum_items integer,
  maximum_items integer,
  maximum_item_length integer,
  require_unique boolean default false
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    pg_catalog.jsonb_typeof(value) = 'array'
    and pg_catalog.jsonb_array_length(value) between minimum_items and maximum_items
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(value) as item(element)
      where pg_catalog.jsonb_typeof(item.element) <> 'string'
        or pg_catalog.char_length(item.element #>> '{}') = 0
        or pg_catalog.char_length(pg_catalog.btrim(item.element #>> '{}')) = 0
        or pg_catalog.char_length(item.element #>> '{}') > maximum_item_length
    )
    and (
      not require_unique
      or pg_catalog.jsonb_array_length(value) = (
        select pg_catalog.count(distinct item.element #>> '{}')
        from pg_catalog.jsonb_array_elements(value) as item(element)
      )
    );
$$;

create table public.source_conversations (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  bee_source_id text not null,
  source_kind text not null,
  title text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  transcript_hash text not null,
  source_revision text not null,
  consent_status text not null,
  consent_confirmed_at timestamptz,
  consent_revoked_at timestamptz,
  status text not null,
  imported_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint source_conversations_learner_id_key unique (learner_id, id),
  constraint source_conversations_provenance_key unique (learner_id, id, source_revision),
  constraint source_conversations_source_identity_key
    unique (learner_id, source_kind, bee_source_id, source_revision),
  constraint source_conversations_bee_source_id_check
    check (char_length(bee_source_id) between 1 and 256 and char_length(btrim(bee_source_id)) > 0),
  constraint source_conversations_source_kind_check check (source_kind in ('bee', 'fixture')),
  constraint source_conversations_title_check
    check (char_length(title) between 1 and 256 and char_length(btrim(title)) > 0),
  constraint source_conversations_chronology_check check (ended_at is null or ended_at >= started_at),
  constraint source_conversations_transcript_hash_check check (transcript_hash ~ '^[a-f0-9]{64}$'),
  constraint source_conversations_source_revision_check
    check (char_length(source_revision) between 1 and 512 and char_length(btrim(source_revision)) > 0),
  constraint source_conversations_consent_status_check
    check (consent_status in ('pending', 'confirmed', 'revoked')),
  constraint source_conversations_status_check check (status in ('processing', 'ready', 'failed')),
  constraint source_conversations_consent_timestamps_check check (
    (consent_status = 'pending' and consent_confirmed_at is null and consent_revoked_at is null)
    or
    (consent_status = 'confirmed' and consent_confirmed_at is not null and consent_revoked_at is null)
    or
    (
      consent_status = 'revoked'
      and consent_confirmed_at is not null
      and consent_revoked_at is not null
      and consent_revoked_at >= consent_confirmed_at
    )
  )
);

create table public.instruction_revisions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  source_conversation_id uuid not null,
  source_revision text not null,
  revision text not null,
  previous_revision_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  constraint instruction_revisions_learner_id_key unique (learner_id, id),
  constraint instruction_revisions_provenance_key
    unique (learner_id, id, source_conversation_id, source_revision),
  constraint instruction_revisions_snapshot_key
    unique (learner_id, source_conversation_id, source_revision, revision),
  constraint instruction_revisions_full_key
    unique (learner_id, id, source_conversation_id, source_revision, revision),
  constraint instruction_revisions_source_fkey
    foreign key (learner_id, source_conversation_id, source_revision)
    references public.source_conversations (learner_id, id, source_revision)
    on delete cascade,
  constraint instruction_revisions_previous_fkey
    foreign key (learner_id, previous_revision_id)
    references public.instruction_revisions (learner_id, id)
    on delete cascade,
  constraint instruction_revisions_source_revision_check
    check (char_length(source_revision) between 1 and 512 and char_length(btrim(source_revision)) > 0),
  constraint instruction_revisions_revision_check
    check (char_length(revision) between 1 and 512 and char_length(btrim(revision)) > 0),
  constraint instruction_revisions_previous_check check (previous_revision_id is null or previous_revision_id <> id)
);

create table public.source_evidence (
  id text primary key,
  learner_id uuid not null references auth.users(id) on delete cascade,
  source_conversation_id uuid not null,
  source_revision text not null,
  start_ms bigint not null,
  end_ms bigint not null,
  quote text not null,
  utterance_ids jsonb not null,
  speaker_label text,
  created_at timestamptz not null default statement_timestamp(),
  constraint source_evidence_learner_id_key unique (learner_id, id),
  constraint source_evidence_provenance_key
    unique (learner_id, id, source_conversation_id, source_revision),
  constraint source_evidence_source_fkey
    foreign key (learner_id, source_conversation_id, source_revision)
    references public.source_conversations (learner_id, id, source_revision)
    on delete cascade,
  constraint source_evidence_id_format_check check (id ~ '^evd_[a-f0-9]{64}$'),
  constraint source_evidence_source_revision_check
    check (char_length(source_revision) between 1 and 512 and char_length(btrim(source_revision)) > 0),
  constraint source_evidence_range_check
    check (start_ms >= 0 and end_ms > start_ms and end_ms <= 9007199254740991),
  constraint source_evidence_quote_check
    check (char_length(quote) between 1 and 4000 and char_length(btrim(quote)) > 0),
  constraint source_evidence_utterance_ids_check
    check (private.is_text_array(utterance_ids, 1, 100, 256, true)),
  constraint source_evidence_speaker_label_check
    check (
      speaker_label is null
      or (char_length(speaker_label) between 1 and 256 and char_length(btrim(speaker_label)) > 0)
    ),
  constraint source_evidence_digest_check check (
    id = 'evd_' || encode(
      extensions.digest(
        convert_to(
          source_conversation_id::text || E'\n'
          || source_revision || E'\n'
          || start_ms::text || E'\n'
          || end_ms::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  )
);

create table public.instructions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  source_conversation_id uuid not null,
  source_revision text not null,
  instruction_revision_id uuid not null,
  text text not null,
  situation text not null,
  expected_action text not null,
  exceptions jsonb not null default '[]'::jsonb,
  confidence numeric not null,
  status text not null,
  supersedes_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint instructions_learner_id_key unique (learner_id, id),
  constraint instructions_revision_key unique (learner_id, id, source_revision),
  constraint instructions_provenance_key
    unique (learner_id, id, source_conversation_id, source_revision),
  constraint instructions_source_fkey
    foreign key (learner_id, source_conversation_id, source_revision)
    references public.source_conversations (learner_id, id, source_revision)
    on delete cascade,
  constraint instructions_snapshot_fkey
    foreign key (
      learner_id, instruction_revision_id, source_conversation_id, source_revision
    )
    references public.instruction_revisions (
      learner_id, id, source_conversation_id, source_revision
    )
    on delete cascade,
  constraint instructions_supersedes_fkey
    foreign key (learner_id, supersedes_id)
    references public.instructions (learner_id, id)
    on delete cascade,
  constraint instructions_source_revision_check
    check (char_length(source_revision) between 1 and 512 and char_length(btrim(source_revision)) > 0),
  constraint instructions_text_check
    check (char_length(text) between 1 and 4000 and char_length(btrim(text)) > 0),
  constraint instructions_situation_check
    check (char_length(situation) between 1 and 4000 and char_length(btrim(situation)) > 0),
  constraint instructions_expected_action_check
    check (char_length(expected_action) between 1 and 4000 and char_length(btrim(expected_action)) > 0),
  constraint instructions_exceptions_check check (private.is_text_array(exceptions, 0, 20, 4000, false)),
  constraint instructions_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint instructions_status_check check (status in ('needsReview', 'confirmed', 'rejected', 'changed')),
  constraint instructions_supersedes_check check (supersedes_id is null or supersedes_id <> id)
);

create table public.instruction_evidence (
  learner_id uuid not null references auth.users(id) on delete cascade,
  instruction_id uuid not null,
  source_conversation_id uuid not null,
  source_revision text not null,
  evidence_id text not null,
  position smallint not null,
  primary key (learner_id, instruction_id, evidence_id),
  constraint instruction_evidence_position_key unique (learner_id, instruction_id, position),
  constraint instruction_evidence_instruction_fkey
    foreign key (learner_id, instruction_id, source_conversation_id, source_revision)
    references public.instructions (learner_id, id, source_conversation_id, source_revision)
    on delete cascade,
  constraint instruction_evidence_evidence_fkey
    foreign key (learner_id, evidence_id, source_conversation_id, source_revision)
    references public.source_evidence (learner_id, id, source_conversation_id, source_revision)
    on delete restrict,
  constraint instruction_evidence_position_check check (position between 1 and 100)
);

create table public.change_proposals (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  previous_instruction_id uuid not null,
  previous_source_revision text not null,
  replacement_instruction_id uuid not null,
  source_revision text not null,
  status text not null default 'needsReview',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint change_proposals_learner_id_key unique (learner_id, id),
  constraint change_proposals_revision_key unique (learner_id, id, source_revision),
  constraint change_proposals_replacement_key unique (learner_id, replacement_instruction_id),
  constraint change_proposals_previous_instruction_fkey
    foreign key (learner_id, previous_instruction_id, previous_source_revision)
    references public.instructions (learner_id, id, source_revision)
    on delete restrict,
  constraint change_proposals_replacement_instruction_fkey
    foreign key (learner_id, replacement_instruction_id, source_revision)
    references public.instructions (learner_id, id, source_revision)
    on delete restrict,
  constraint change_proposals_distinct_instructions_check
    check (previous_instruction_id <> replacement_instruction_id),
  constraint change_proposals_previous_revision_check
    check (
      char_length(previous_source_revision) between 1 and 512
      and char_length(btrim(previous_source_revision)) > 0
    ),
  constraint change_proposals_source_revision_check
    check (char_length(source_revision) between 1 and 512 and char_length(btrim(source_revision)) > 0),
  constraint change_proposals_status_check check (status in ('needsReview', 'confirmed'))
);

create table public.practice_sets (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  source_conversation_id uuid not null,
  source_revision text not null,
  source_kind text not null,
  title text not null,
  kind text not null,
  instruction_revision_id uuid not null,
  instruction_revision text not null,
  change_proposal_id uuid,
  status text not null default 'draft',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint practice_sets_learner_id_key unique (learner_id, id),
  constraint practice_sets_scenario_parent_key unique (learner_id, id, source_revision, kind),
  constraint practice_sets_source_fkey
    foreign key (learner_id, source_conversation_id, source_revision)
    references public.source_conversations (learner_id, id, source_revision)
    on delete cascade,
  constraint practice_sets_instruction_revision_fkey
    foreign key (
      learner_id, instruction_revision_id, source_conversation_id,
      source_revision, instruction_revision
    )
    references public.instruction_revisions (
      learner_id, id, source_conversation_id, source_revision, revision
    )
    on delete restrict,
  constraint practice_sets_change_proposal_fkey
    foreign key (learner_id, change_proposal_id, source_revision)
    references public.change_proposals (learner_id, id, source_revision)
    on delete restrict,
  constraint practice_sets_source_revision_check
    check (char_length(source_revision) between 1 and 512 and char_length(btrim(source_revision)) > 0),
  constraint practice_sets_source_kind_check check (source_kind in ('bee', 'fixture')),
  constraint practice_sets_title_check
    check (char_length(title) between 1 and 256 and char_length(btrim(title)) > 0),
  constraint practice_sets_kind_check check (kind in ('standard', 'changeDrill')),
  constraint practice_sets_instruction_revision_check
    check (
      char_length(instruction_revision) between 1 and 512
      and char_length(btrim(instruction_revision)) > 0
    ),
  constraint practice_sets_change_kind_check check (
    (kind = 'standard' and change_proposal_id is null)
    or (kind = 'changeDrill' and change_proposal_id is not null)
  ),
  constraint practice_sets_status_check
    check (status in ('draft', 'ready', 'inProgress', 'complete', 'stale'))
);

create table public.practice_set_instructions (
  learner_id uuid not null references auth.users(id) on delete cascade,
  practice_set_id uuid not null,
  instruction_id uuid not null,
  instruction_source_revision text not null,
  position smallint not null,
  primary key (learner_id, practice_set_id, instruction_id),
  constraint practice_set_instructions_position_key unique (learner_id, practice_set_id, position),
  constraint practice_set_instructions_practice_set_fkey
    foreign key (learner_id, practice_set_id)
    references public.practice_sets (learner_id, id)
    on delete cascade,
  constraint practice_set_instructions_instruction_fkey
    foreign key (learner_id, instruction_id, instruction_source_revision)
    references public.instructions (learner_id, id, source_revision)
    on delete restrict,
  constraint practice_set_instructions_position_check check (position between 1 and 20)
);

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  practice_set_id uuid not null,
  source_revision text not null,
  kind text not null,
  character_id text not null,
  prompt text not null,
  context text not null,
  acceptable_signals jsonb not null,
  critical_misses jsonb not null default '[]'::jsonb,
  retry_prompt text not null,
  ordering smallint not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint scenarios_learner_id_key unique (learner_id, id),
  constraint scenarios_revision_key unique (learner_id, id, source_revision),
  constraint scenarios_position_key unique (learner_id, practice_set_id, ordering),
  constraint scenarios_practice_set_fkey
    foreign key (learner_id, practice_set_id, source_revision, kind)
    references public.practice_sets (learner_id, id, source_revision, kind)
    on delete cascade,
  constraint scenarios_source_revision_check
    check (char_length(source_revision) between 1 and 512 and char_length(btrim(source_revision)) > 0),
  constraint scenarios_kind_check check (kind in ('standard', 'changeDrill')),
  constraint scenarios_character_check check (character_id in ('customer-rowan', 'guide-maya')),
  constraint scenarios_prompt_check
    check (char_length(prompt) between 1 and 4000 and char_length(btrim(prompt)) > 0),
  constraint scenarios_context_check
    check (char_length(context) between 1 and 4000 and char_length(btrim(context)) > 0),
  constraint scenarios_acceptable_signals_check
    check (private.is_text_array(acceptable_signals, 1, 20, 4000, true)),
  constraint scenarios_critical_misses_check
    check (private.is_text_array(critical_misses, 0, 20, 4000, true)),
  constraint scenarios_retry_prompt_check
    check (char_length(retry_prompt) between 1 and 4000 and char_length(btrim(retry_prompt)) > 0),
  constraint scenarios_ordering_check check (ordering > 0)
);

create table public.scenario_rules (
  learner_id uuid not null references auth.users(id) on delete cascade,
  scenario_id uuid not null,
  instruction_id uuid not null,
  instruction_source_revision text not null,
  position smallint not null,
  primary key (learner_id, scenario_id, instruction_id),
  constraint scenario_rules_position_key unique (learner_id, scenario_id, position),
  constraint scenario_rules_scenario_fkey
    foreign key (learner_id, scenario_id)
    references public.scenarios (learner_id, id)
    on delete cascade,
  constraint scenario_rules_instruction_fkey
    foreign key (learner_id, instruction_id, instruction_source_revision)
    references public.instructions (learner_id, id, source_revision)
    on delete restrict,
  constraint scenario_rules_position_check check (position between 1 and 20)
);

create table public.scenario_evidence (
  learner_id uuid not null references auth.users(id) on delete cascade,
  scenario_id uuid not null,
  source_conversation_id uuid not null,
  source_revision text not null,
  evidence_id text not null,
  position smallint not null,
  primary key (learner_id, scenario_id, evidence_id),
  constraint scenario_evidence_position_key unique (learner_id, scenario_id, position),
  constraint scenario_evidence_scenario_fkey
    foreign key (learner_id, scenario_id)
    references public.scenarios (learner_id, id)
    on delete cascade,
  constraint scenario_evidence_evidence_fkey
    foreign key (learner_id, evidence_id, source_conversation_id, source_revision)
    references public.source_evidence (learner_id, id, source_conversation_id, source_revision)
    on delete restrict,
  constraint scenario_evidence_position_check check (position between 1 and 100)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  scenario_id uuid not null,
  source_revision text not null,
  instruction_revision text not null,
  response_text text not null,
  input_mode text not null,
  result text not null,
  feedback text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint attempts_learner_id_key unique (learner_id, id),
  constraint attempts_scenario_key unique (learner_id, id, scenario_id),
  constraint attempts_scenario_fkey
    foreign key (learner_id, scenario_id, source_revision)
    references public.scenarios (learner_id, id, source_revision)
    on delete restrict,
  constraint attempts_source_revision_check
    check (char_length(source_revision) between 1 and 512 and char_length(btrim(source_revision)) > 0),
  constraint attempts_instruction_revision_check
    check (
      char_length(instruction_revision) between 1 and 512
      and char_length(btrim(instruction_revision)) > 0
    ),
  constraint attempts_response_text_check
    check (char_length(response_text) between 1 and 4000 and char_length(btrim(response_text)) > 0),
  constraint attempts_input_mode_check check (input_mode in ('voice', 'text')),
  constraint attempts_result_check check (result in ('covered', 'partial', 'missed', 'needsReview')),
  constraint attempts_feedback_check
    check (char_length(feedback) between 1 and 4000 and char_length(btrim(feedback)) > 0)
);

create table public.attempt_rule_results (
  learner_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null,
  scenario_id uuid not null,
  instruction_id uuid not null,
  disposition text not null,
  position smallint not null,
  primary key (learner_id, attempt_id, instruction_id),
  constraint attempt_rule_results_position_key unique (learner_id, attempt_id, position),
  constraint attempt_rule_results_attempt_fkey
    foreign key (learner_id, attempt_id, scenario_id)
    references public.attempts (learner_id, id, scenario_id)
    on delete cascade,
  constraint attempt_rule_results_scenario_rule_fkey
    foreign key (learner_id, scenario_id, instruction_id)
    references public.scenario_rules (learner_id, scenario_id, instruction_id)
    on delete restrict,
  constraint attempt_rule_results_disposition_check check (disposition in ('matched', 'missed')),
  constraint attempt_rule_results_position_check check (position between 1 and 20)
);

create table public.open_questions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  source_conversation_id uuid not null,
  source_revision text not null,
  instruction_id uuid,
  question text not null,
  status text not null default 'open',
  share_consent boolean not null default false,
  resolution text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint open_questions_learner_id_key unique (learner_id, id),
  constraint open_questions_provenance_key
    unique (learner_id, id, source_conversation_id, source_revision),
  constraint open_questions_source_fkey
    foreign key (learner_id, source_conversation_id, source_revision)
    references public.source_conversations (learner_id, id, source_revision)
    on delete cascade,
  constraint open_questions_instruction_fkey
    foreign key (learner_id, instruction_id, source_conversation_id, source_revision)
    references public.instructions (learner_id, id, source_conversation_id, source_revision)
    on delete restrict,
  constraint open_questions_source_revision_check
    check (char_length(source_revision) between 1 and 512 and char_length(btrim(source_revision)) > 0),
  constraint open_questions_question_check
    check (char_length(question) between 1 and 4000 and char_length(btrim(question)) > 0),
  constraint open_questions_status_check check (status in ('open', 'resolved', 'dismissed')),
  constraint open_questions_resolution_check check (
    resolution is null
    or (char_length(resolution) between 1 and 4000 and char_length(btrim(resolution)) > 0)
  ),
  constraint open_questions_resolved_check check (status <> 'resolved' or resolution is not null)
);

create table public.open_question_evidence (
  learner_id uuid not null references auth.users(id) on delete cascade,
  open_question_id uuid not null,
  source_conversation_id uuid not null,
  source_revision text not null,
  evidence_id text not null,
  position smallint not null,
  primary key (learner_id, open_question_id, evidence_id),
  constraint open_question_evidence_position_key unique (learner_id, open_question_id, position),
  constraint open_question_evidence_question_fkey
    foreign key (learner_id, open_question_id, source_conversation_id, source_revision)
    references public.open_questions (learner_id, id, source_conversation_id, source_revision)
    on delete cascade,
  constraint open_question_evidence_evidence_fkey
    foreign key (learner_id, evidence_id, source_conversation_id, source_revision)
    references public.source_evidence (learner_id, id, source_conversation_id, source_revision)
    on delete restrict,
  constraint open_question_evidence_position_check check (position between 1 and 100)
);

create table private.source_materials (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  source_conversation_id uuid not null,
  source_revision text not null,
  transcript text not null,
  utterances jsonb not null,
  speakers jsonb,
  source_url text,
  created_at timestamptz not null default statement_timestamp(),
  constraint source_materials_source_key unique (learner_id, source_conversation_id, source_revision),
  constraint source_materials_source_fkey
    foreign key (learner_id, source_conversation_id, source_revision)
    references public.source_conversations (learner_id, id, source_revision)
    on delete cascade,
  constraint source_materials_transcript_check
    check (char_length(transcript) between 1 and 2000000 and char_length(btrim(transcript)) > 0),
  constraint source_materials_utterances_check check (
    jsonb_typeof(utterances) = 'array'
    and jsonb_array_length(utterances) between 1 and 10000
    and octet_length(utterances::text) <= 8000000
  ),
  constraint source_materials_speakers_check check (
    speakers is null
    or (
      jsonb_typeof(speakers) = 'array'
      and jsonb_array_length(speakers) <= 100
      and octet_length(speakers::text) <= 100000
    )
  ),
  constraint source_materials_source_url_check check (
    source_url is null
    or (
      char_length(source_url) <= 4000
      and source_url ~ '^https?://'
    )
  )
);

create table private.extraction_inputs (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  source_conversation_id uuid not null,
  source_revision text not null,
  instruction_revision_id uuid not null,
  payload jsonb not null,
  excluded_ranges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint extraction_inputs_snapshot_key unique (learner_id, instruction_revision_id),
  constraint extraction_inputs_source_fkey
    foreign key (learner_id, source_conversation_id, source_revision)
    references public.source_conversations (learner_id, id, source_revision)
    on delete cascade,
  constraint extraction_inputs_instruction_revision_fkey
    foreign key (
      learner_id, instruction_revision_id, source_conversation_id, source_revision
    )
    references public.instruction_revisions (
      learner_id, id, source_conversation_id, source_revision
    )
    on delete cascade,
  constraint extraction_inputs_payload_check check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000000
  ),
  constraint extraction_inputs_excluded_ranges_check check (
    jsonb_typeof(excluded_ranges) = 'array'
    and jsonb_array_length(excluded_ranges) <= 100
    and octet_length(excluded_ranges::text) <= 500000
  )
);

create table private.consent_events (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  source_conversation_id uuid not null,
  source_revision text not null,
  consent_status text not null,
  reason text,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint consent_events_source_fkey
    foreign key (learner_id, source_conversation_id, source_revision)
    references public.source_conversations (learner_id, id, source_revision)
    on delete cascade,
  constraint consent_events_status_check check (consent_status in ('pending', 'confirmed', 'revoked')),
  constraint consent_events_reason_check check (
    reason is null
    or (char_length(reason) between 1 and 4000 and char_length(btrim(reason)) > 0)
  )
);

create function private.lock_source_processable(
  p_learner_id uuid,
  p_source_conversation_id uuid,
  p_source_revision text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.source_conversations source
  where source.learner_id = p_learner_id
    and source.id = p_source_conversation_id
    and source.source_revision = p_source_revision
    and source.consent_status = 'confirmed'
    and source.status = 'ready'
  for share;

  if not found then
    raise exception using errcode = '23514', message = 'source is not processable';
  end if;
end;
$$;

create function private.assert_source_processable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.lock_source_processable(
    new.learner_id,
    new.source_conversation_id,
    new.source_revision
  );

  return new;
end;
$$;

create function private.validate_source_conversation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.consent_status = 'revoked' then
      raise exception using errcode = '23514', message = 'a source cannot be imported as revoked';
    end if;

    if new.consent_status = 'confirmed' and new.consent_confirmed_at is null then
      new.consent_confirmed_at := statement_timestamp();
    end if;

    if new.status = 'ready' and new.consent_status <> 'confirmed' then
      raise exception using errcode = '23514', message = 'a ready source requires confirmed consent';
    end if;

    return new;
  end if;

  if row(
    new.id, new.learner_id, new.bee_source_id, new.source_kind,
    new.started_at, new.ended_at, new.transcript_hash, new.source_revision,
    new.imported_at
  ) is distinct from row(
    old.id, old.learner_id, old.bee_source_id, old.source_kind,
    old.started_at, old.ended_at, old.transcript_hash, old.source_revision,
    old.imported_at
  ) then
    raise exception using errcode = '23514', message = 'source identity and provenance are immutable';
  end if;

  if new.consent_status is distinct from old.consent_status then
    if old.consent_status = 'pending' and new.consent_status = 'confirmed' then
      new.consent_confirmed_at := statement_timestamp();
      new.consent_revoked_at := null;
    elsif old.consent_status = 'confirmed' and new.consent_status = 'revoked' then
      new.consent_confirmed_at := old.consent_confirmed_at;
      new.consent_revoked_at := statement_timestamp();
    else
      raise exception using errcode = '23514', message = 'invalid source-consent state transition';
    end if;
  elsif row(new.consent_confirmed_at, new.consent_revoked_at)
    is distinct from row(old.consent_confirmed_at, old.consent_revoked_at) then
    raise exception using errcode = '23514', message = 'consent timestamps are server controlled';
  end if;

  if new.status is distinct from old.status
    and not (old.status = 'processing' and new.status in ('ready', 'failed')) then
    raise exception using errcode = '23514', message = 'invalid source state transition';
  end if;

  if new.status = 'ready'
    and new.consent_status <> 'confirmed'
    and not (
      tg_op = 'UPDATE'
      and old.consent_status = 'confirmed'
      and new.consent_status = 'revoked'
    ) then
    raise exception using errcode = '23514', message = 'a ready source requires confirmed consent';
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create function private.audit_source_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_reason text;
begin
  if tg_op = 'UPDATE' and new.consent_status = old.consent_status then
    return new;
  end if;

  audit_reason := nullif(pg_catalog.current_setting('firstday.consent_reason', true), '');

  if new.consent_status = 'revoked' then
    delete from private.extraction_inputs
    where learner_id = new.learner_id
      and source_conversation_id = new.id;

    delete from private.source_materials
    where learner_id = new.learner_id
      and source_conversation_id = new.id;

    update public.practice_sets practice
    set status = 'stale', updated_at = statement_timestamp()
    where practice.learner_id = new.learner_id
      and practice.status <> 'stale'
      and (
        practice.source_conversation_id = new.id
        or exists (
          select 1
          from public.practice_set_instructions link
          join public.instructions instruction
            on instruction.learner_id = link.learner_id
           and instruction.id = link.instruction_id
          where link.learner_id = practice.learner_id
            and link.practice_set_id = practice.id
            and instruction.source_conversation_id = new.id
        )
      );
  end if;

  insert into private.consent_events (
    learner_id, source_conversation_id, source_revision,
    consent_status, reason, occurred_at
  ) values (
    new.learner_id, new.id, new.source_revision,
    new.consent_status, audit_reason, statement_timestamp()
  );

  return new;
end;
$$;

create function private.validate_source_material()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_hash text;
begin
  select source.transcript_hash
  into expected_hash
  from public.source_conversations source
  where source.learner_id = new.learner_id
    and source.id = new.source_conversation_id
    and source.source_revision = new.source_revision
    and source.consent_status = 'confirmed'
    and source.status = 'ready'
  for share;

  if expected_hash is null then
    raise exception using errcode = '23514', message = 'source is not processable';
  end if;

  if encode(extensions.digest(convert_to(new.transcript, 'UTF8'), 'sha256'), 'hex') <> expected_hash then
    raise exception using errcode = '23514', message = 'raw transcript does not match transcript_hash';
  end if;

  return new;
end;
$$;

create function private.validate_instruction_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal_id uuid;
  confirmation_id text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'needsReview' then
      raise exception using errcode = '23514', message = 'new instructions must require review';
    end if;
    return new;
  end if;

  if row(
    new.id, new.learner_id, new.source_conversation_id, new.source_revision,
    new.instruction_revision_id, new.confidence, new.supersedes_id, new.created_at
  ) is distinct from row(
    old.id, old.learner_id, old.source_conversation_id, old.source_revision,
    old.instruction_revision_id, old.confidence, old.supersedes_id, old.created_at
  ) then
    raise exception using errcode = '23514', message = 'instruction provenance is immutable';
  end if;

  confirmation_id := pg_catalog.current_setting('firstday.change_confirmation', true);

  if old.status <> 'needsReview' then
    if old.status = 'confirmed' and new.status = 'changed' then
      select proposal.id
      into proposal_id
      from public.change_proposals proposal
      where proposal.learner_id = old.learner_id
        and proposal.previous_instruction_id = old.id
        and proposal.id::text = confirmation_id;

      if proposal_id is null then
        raise exception using
          errcode = '23514',
          message = 'confirmed instructions can change only through controlled change confirmation';
      end if;

      if row(new.text, new.situation, new.expected_action, new.exceptions)
        is distinct from row(old.text, old.situation, old.expected_action, old.exceptions) then
        raise exception using errcode = '23514', message = 'reviewed instruction content and provenance are immutable';
      end if;
    else
      raise exception using errcode = '23514', message = 'reviewed instruction content and provenance are immutable';
    end if;
  else
    if new.status = 'changed' then
      raise exception using errcode = '23514', message = 'invalid instruction state transition';
    end if;

    if new.status = 'confirmed' then
      select proposal.id
      into proposal_id
      from public.change_proposals proposal
      where proposal.learner_id = old.learner_id
        and proposal.replacement_instruction_id = old.id
        and proposal.status = 'needsReview';

      if proposal_id is not null and proposal_id::text is distinct from confirmation_id then
        raise exception using
          errcode = '23514',
          message = 'change replacements can be confirmed only through controlled change confirmation';
      end if;

      if not exists (
        select 1
        from public.instruction_evidence evidence
        where evidence.learner_id = old.learner_id
          and evidence.instruction_id = old.id
      ) then
        raise exception using errcode = '23514', message = 'confirmed instructions require source evidence';
      end if;
    end if;
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create function private.prevent_instruction_revision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'instruction revisions are immutable extraction snapshots';
end;
$$;

create function private.guard_instruction_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_status text;
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op <> 'INSERT' then
    select instruction.status into parent_status
    from public.instructions instruction
    where instruction.learner_id = old.learner_id
      and instruction.id = old.instruction_id
    for share;

    if parent_status is distinct from 'needsReview' then
      raise exception using errcode = '23514', message = 'reviewed instruction evidence is immutable';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    select instruction.status into parent_status
    from public.instructions instruction
    where instruction.learner_id = new.learner_id
      and instruction.id = new.instruction_id
    for share;

    if parent_status is distinct from 'needsReview' then
      raise exception using errcode = '23514', message = 'reviewed instruction evidence is immutable';
    end if;
    return new;
  end if;

  return old;
end;
$$;

create function private.guard_reviewed_source_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.instructions instruction
  where instruction.learner_id = old.learner_id
    and exists (
      select 1
      from public.instruction_evidence link
      where link.learner_id = old.learner_id
        and link.evidence_id = old.id
        and link.instruction_id = instruction.id
    )
  order by instruction.id
  for share;

  if exists (
    select 1
    from public.instruction_evidence link
    join public.instructions instruction
      on instruction.learner_id = link.learner_id
     and instruction.id = link.instruction_id
    where link.learner_id = old.learner_id
      and link.evidence_id = old.id
      and instruction.status <> 'needsReview'
  ) then
    raise exception using
      errcode = '23514',
      message = 'evidence attached to a reviewed instruction is immutable';
  end if;

  return new;
end;
$$;

create function private.validate_change_proposal_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_status text;
  previous_source_id uuid;
  previous_instruction_revision_id uuid;
  replacement_status text;
  replacement_supersedes_id uuid;
  replacement_source_id uuid;
  replacement_previous_revision_id uuid;
  confirmation_id text;
  source_record record;
begin
  for source_record in
    select instruction.source_conversation_id, instruction.source_revision, instruction.id
    from public.instructions instruction
    where instruction.learner_id = new.learner_id
      and (
        (
          instruction.id = new.previous_instruction_id
          and instruction.source_revision = new.previous_source_revision
        )
        or (
          instruction.id = new.replacement_instruction_id
          and instruction.source_revision = new.source_revision
        )
      )
    order by instruction.source_conversation_id, instruction.id
  loop
    perform private.lock_source_processable(
      new.learner_id,
      source_record.source_conversation_id,
      source_record.source_revision
    );
  end loop;

  perform 1
  from public.instructions instruction
  where instruction.learner_id = new.learner_id
    and instruction.id in (new.previous_instruction_id, new.replacement_instruction_id)
  order by instruction.id
  for share;

  select
    instruction.status,
    instruction.source_conversation_id,
    instruction.instruction_revision_id
  into previous_status, previous_source_id, previous_instruction_revision_id
  from public.instructions instruction
  join public.source_conversations source
    on source.learner_id = instruction.learner_id
   and source.id = instruction.source_conversation_id
  where instruction.learner_id = new.learner_id
    and instruction.id = new.previous_instruction_id
    and instruction.source_revision = new.previous_source_revision
    and source.consent_status = 'confirmed'
    and source.status = 'ready';

  select
    instruction.status,
    instruction.supersedes_id,
    instruction.source_conversation_id,
    snapshot.previous_revision_id
  into
    replacement_status,
    replacement_supersedes_id,
    replacement_source_id,
    replacement_previous_revision_id
  from public.instructions instruction
  join public.instruction_revisions snapshot
    on snapshot.learner_id = instruction.learner_id
   and snapshot.id = instruction.instruction_revision_id
   and snapshot.source_conversation_id = instruction.source_conversation_id
   and snapshot.source_revision = instruction.source_revision
  join public.source_conversations source
    on source.learner_id = instruction.learner_id
   and source.id = instruction.source_conversation_id
  where instruction.learner_id = new.learner_id
    and instruction.id = new.replacement_instruction_id
    and instruction.source_revision = new.source_revision
    and source.consent_status = 'confirmed'
    and source.status = 'ready';

  if previous_source_id is null
    or replacement_source_id is null
    or previous_source_id = replacement_source_id
    or replacement_supersedes_id is distinct from new.previous_instruction_id then
    raise exception using errcode = '23514', message = 'replacement instruction must supersede the previous instruction';
  end if;

  if replacement_previous_revision_id is distinct from previous_instruction_revision_id then
    raise exception using
      errcode = '23514',
      message = 'replacement instruction snapshot must descend from the previous instruction snapshot';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'needsReview'
      or previous_status <> 'confirmed'
      or replacement_status <> 'needsReview' then
      raise exception using errcode = '23514', message = 'new change proposals require reviewed previous and replacement states';
    end if;
    return new;
  end if;

  if row(
    new.id, new.learner_id, new.previous_instruction_id,
    new.previous_source_revision, new.replacement_instruction_id,
    new.source_revision, new.created_at
  ) is distinct from row(
    old.id, old.learner_id, old.previous_instruction_id,
    old.previous_source_revision, old.replacement_instruction_id,
    old.source_revision, old.created_at
  ) then
    raise exception using errcode = '23514', message = 'change proposal provenance is immutable';
  end if;

  confirmation_id := pg_catalog.current_setting('firstday.change_confirmation', true);
  if old.status <> 'needsReview'
    or new.status <> 'confirmed'
    or confirmation_id is distinct from old.id::text
    or previous_status <> 'changed'
    or replacement_status <> 'confirmed' then
    raise exception using errcode = '23514', message = 'invalid change-proposal state transition';
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create function private.validate_open_question_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception using errcode = '23514', message = 'new questions must be open';
    end if;
    return new;
  end if;

  if row(
    new.id, new.learner_id, new.source_conversation_id,
    new.source_revision, new.instruction_id, new.created_at
  ) is distinct from row(
    old.id, old.learner_id, old.source_conversation_id,
    old.source_revision, old.instruction_id, old.created_at
  ) then
    raise exception using errcode = '23514', message = 'open-question provenance is immutable';
  end if;

  if old.status <> 'open' then
    raise exception using errcode = '23514', message = 'resolved and dismissed questions are terminal';
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create function private.guard_open_question_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_status text;
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op <> 'INSERT' then
    select question.status into parent_status
    from public.open_questions question
    where question.learner_id = old.learner_id
      and question.id = old.open_question_id
    for share;

    if parent_status is distinct from 'open' then
      raise exception using
        errcode = '23514',
        message = 'resolved and dismissed question evidence is immutable';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    select question.status into parent_status
    from public.open_questions question
    where question.learner_id = new.learner_id
      and question.id = new.open_question_id
    for share;

    if parent_status is distinct from 'open' then
      raise exception using
        errcode = '23514',
        message = 'resolved and dismissed question evidence is immutable';
    end if;
    return new;
  end if;

  return old;
end;
$$;

create function private.practice_progress(p_learner_id uuid, p_practice_set_id uuid)
returns table (completed integer, total integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(distinct scenario.id) filter (
      where exists (
        select 1
        from public.attempts attempt
        where attempt.learner_id = scenario.learner_id
          and attempt.scenario_id = scenario.id
          and attempt.result = 'covered'
      )
    )::integer as completed,
    count(distinct scenario.id)::integer as total
  from public.scenarios scenario
  where scenario.learner_id = p_learner_id
    and scenario.practice_set_id = p_practice_set_id;
$$;

create function private.assert_practice_set_ready(p_learner_id uuid, p_practice_set_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  practice public.practice_sets%rowtype;
  expected_scenarios integer;
  scenario_count integer;
  instruction_count integer;
begin
  select * into practice
  from public.practice_sets
  where learner_id = p_learner_id and id = p_practice_set_id;

  if not found then
    raise exception using errcode = '23503', message = 'practice set does not exist';
  end if;

  if not exists (
    select 1
    from public.source_conversations source
    where source.learner_id = practice.learner_id
      and source.id = practice.source_conversation_id
      and source.source_revision = practice.source_revision
      and source.source_kind = practice.source_kind
      and source.consent_status = 'confirmed'
      and source.status = 'ready'
  ) then
    raise exception using errcode = '23514', message = 'source is not processable';
  end if;

  expected_scenarios := case when practice.kind = 'standard' then 3 else 1 end;
  select count(*)::integer into scenario_count
  from public.scenarios
  where learner_id = practice.learner_id and practice_set_id = practice.id;

  if scenario_count <> expected_scenarios
    or exists (
      select 1
      from generate_series(1, expected_scenarios) expected(ordering)
      where not exists (
        select 1
        from public.scenarios scenario
        where scenario.learner_id = practice.learner_id
          and scenario.practice_set_id = practice.id
          and scenario.ordering = expected.ordering
      )
    ) then
    raise exception using errcode = '23514', message = 'practice set has an invalid scenario sequence';
  end if;

  select count(*)::integer into instruction_count
  from public.practice_set_instructions link
  where link.learner_id = practice.learner_id
    and link.practice_set_id = practice.id;

  if instruction_count < 1 or instruction_count > 20
    or exists (
      select 1
      from generate_series(1, instruction_count) expected(position)
      where not exists (
        select 1
        from public.practice_set_instructions link
        where link.learner_id = practice.learner_id
          and link.practice_set_id = practice.id
          and link.position = expected.position
      )
    ) then
    raise exception using errcode = '23514', message = 'practice set has an invalid instruction sequence';
  end if;

  if exists (
    select 1
    from public.scenarios scenario
    where scenario.learner_id = practice.learner_id
      and scenario.practice_set_id = practice.id
      and (
        not exists (
          select 1 from public.scenario_rules rule
          where rule.learner_id = scenario.learner_id and rule.scenario_id = scenario.id
        )
        or not exists (
          select 1 from public.scenario_evidence evidence
          where evidence.learner_id = scenario.learner_id and evidence.scenario_id = scenario.id
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'every scenario requires rules and source evidence';
  end if;

  if exists (
    select 1
    from public.scenario_rules rule
    join public.scenarios scenario
      on scenario.learner_id = rule.learner_id and scenario.id = rule.scenario_id
    where scenario.learner_id = practice.learner_id
      and scenario.practice_set_id = practice.id
      and not exists (
        select 1
        from public.practice_set_instructions link
        where link.learner_id = rule.learner_id
          and link.practice_set_id = practice.id
          and link.instruction_id = rule.instruction_id
      )
  ) then
    raise exception using errcode = '23514', message = 'scenario rules must belong to the practice set';
  end if;

  if exists (
    select 1
    from public.scenario_evidence scenario_evidence
    join public.scenarios scenario
      on scenario.learner_id = scenario_evidence.learner_id
     and scenario.id = scenario_evidence.scenario_id
    where scenario.learner_id = practice.learner_id
      and scenario.practice_set_id = practice.id
      and not exists (
        select 1
        from public.instruction_evidence instruction_evidence
        where instruction_evidence.learner_id = scenario.learner_id
          and instruction_evidence.evidence_id = scenario_evidence.evidence_id
          and (
            (
              practice.kind = 'standard'
              and exists (
                select 1
                from public.scenario_rules rule
                where rule.learner_id = scenario.learner_id
                  and rule.scenario_id = scenario.id
                  and rule.instruction_id = instruction_evidence.instruction_id
              )
            )
            or (
              practice.kind = 'changeDrill'
              and exists (
                select 1
                from public.change_proposals proposal
                where proposal.learner_id = practice.learner_id
                  and proposal.id = practice.change_proposal_id
                  and instruction_evidence.instruction_id in (
                    proposal.previous_instruction_id,
                    proposal.replacement_instruction_id
                  )
              )
            )
          )
      )
  ) or exists (
    select 1
    from public.scenario_rules rule
    join public.scenarios scenario
      on scenario.learner_id = rule.learner_id and scenario.id = rule.scenario_id
    join public.instruction_evidence instruction_evidence
      on instruction_evidence.learner_id = rule.learner_id
     and instruction_evidence.instruction_id = rule.instruction_id
    where practice.kind = 'standard'
      and scenario.learner_id = practice.learner_id
      and scenario.practice_set_id = practice.id
      and not exists (
        select 1
        from public.scenario_evidence scenario_evidence
        where scenario_evidence.learner_id = scenario.learner_id
          and scenario_evidence.scenario_id = scenario.id
          and scenario_evidence.evidence_id = instruction_evidence.evidence_id
      )
  ) or exists (
    select 1
    from public.scenarios scenario
    join public.change_proposals proposal
      on proposal.learner_id = scenario.learner_id
     and proposal.id = practice.change_proposal_id
    join public.instruction_evidence instruction_evidence
      on instruction_evidence.learner_id = proposal.learner_id
     and instruction_evidence.instruction_id in (
       proposal.previous_instruction_id,
       proposal.replacement_instruction_id
     )
    where practice.kind = 'changeDrill'
      and scenario.learner_id = practice.learner_id
      and scenario.practice_set_id = practice.id
      and not exists (
        select 1
        from public.scenario_evidence scenario_evidence
        where scenario_evidence.learner_id = scenario.learner_id
          and scenario_evidence.scenario_id = scenario.id
          and scenario_evidence.evidence_id = instruction_evidence.evidence_id
      )
  ) then
    raise exception using errcode = '23514', message = 'scenario evidence must exactly ground its expected rules';
  end if;

  if practice.kind = 'standard' then
    if practice.change_proposal_id is not null
      or exists (
        select 1
        from public.practice_set_instructions link
        join public.instructions instruction
          on instruction.learner_id = link.learner_id and instruction.id = link.instruction_id
        where link.learner_id = practice.learner_id
          and link.practice_set_id = practice.id
          and (
            instruction.status <> 'confirmed'
            or instruction.source_conversation_id <> practice.source_conversation_id
            or instruction.source_revision <> practice.source_revision
            or instruction.instruction_revision_id <> practice.instruction_revision_id
          )
      ) then
      raise exception using errcode = '23514', message = 'standard practice requires confirmed snapshot instructions';
    end if;
  else
    if exists (
      select 1
      from public.change_proposals proposal
      where proposal.learner_id = practice.learner_id
        and proposal.id = practice.change_proposal_id
        and proposal.status = 'confirmed'
    ) and not exists (
      select 1
      from public.change_proposals proposal
      join public.instructions replacement
        on replacement.learner_id = proposal.learner_id
       and replacement.id = proposal.replacement_instruction_id
      join public.instruction_revisions snapshot
        on snapshot.learner_id = replacement.learner_id
       and snapshot.id = replacement.instruction_revision_id
       and snapshot.source_conversation_id = replacement.source_conversation_id
       and snapshot.source_revision = replacement.source_revision
      where proposal.learner_id = practice.learner_id
        and proposal.id = practice.change_proposal_id
        and proposal.status = 'confirmed'
        and replacement.source_conversation_id = practice.source_conversation_id
        and replacement.source_revision = practice.source_revision
        and replacement.instruction_revision_id = practice.instruction_revision_id
        and snapshot.revision = practice.instruction_revision
    ) then
      raise exception using
        errcode = '23514',
        message = 'change drill snapshot must match the replacement instruction';
    end if;

    if instruction_count <> 2
      or not exists (
        select 1
        from public.change_proposals proposal
        where proposal.learner_id = practice.learner_id
          and proposal.id = practice.change_proposal_id
          and proposal.status = 'confirmed'
          and exists (
            select 1 from public.practice_set_instructions link
            where link.learner_id = proposal.learner_id
              and link.practice_set_id = practice.id
              and link.instruction_id = proposal.previous_instruction_id
          )
          and exists (
            select 1 from public.practice_set_instructions link
            where link.learner_id = proposal.learner_id
              and link.practice_set_id = practice.id
              and link.instruction_id = proposal.replacement_instruction_id
          )
          and not exists (
            select 1
            from public.scenario_rules rule
            join public.scenarios scenario
              on scenario.learner_id = rule.learner_id and scenario.id = rule.scenario_id
            where scenario.learner_id = practice.learner_id
              and scenario.practice_set_id = practice.id
              and rule.instruction_id <> proposal.replacement_instruction_id
          )
      ) then
      raise exception using errcode = '23514', message = 'change drills require the confirmed old and replacement rule';
    end if;
  end if;
end;
$$;

create function private.validate_practice_set_mutation()
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

create function private.lock_draft_practice(
  p_learner_id uuid,
  p_practice_set_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_id uuid;
  source_revision text;
begin
  select practice.source_conversation_id, practice.source_revision
  into source_id, source_revision
  from public.practice_sets practice
  where practice.learner_id = p_learner_id
    and practice.id = p_practice_set_id;

  if not found then
    raise exception using errcode = '23514', message = 'practice content is immutable after draft';
  end if;

  perform private.lock_source_processable(p_learner_id, source_id, source_revision);

  perform 1
  from public.practice_sets practice
  where practice.learner_id = p_learner_id
    and practice.id = p_practice_set_id
    and practice.status = 'draft'
  for share;

  if not found then
    raise exception using errcode = '23514', message = 'practice content is immutable after draft';
  end if;
end;
$$;

create function private.guard_practice_child()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_practice_set uuid;
  new_practice_set uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_argv[0] = 'direct' then
      old_practice_set := old.practice_set_id;
    else
      select scenario.practice_set_id
      into old_practice_set
      from public.scenarios scenario
      where scenario.learner_id = old.learner_id and scenario.id = old.scenario_id;
    end if;

    perform private.lock_draft_practice(old.learner_id, old_practice_set);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if tg_argv[0] = 'direct' then
      new_practice_set := new.practice_set_id;
    else
      select scenario.practice_set_id
      into new_practice_set
      from public.scenarios scenario
      where scenario.learner_id = new.learner_id and scenario.id = new.scenario_id;
    end if;

    if tg_op = 'INSERT'
      or new.learner_id is distinct from old.learner_id
      or new_practice_set is distinct from old_practice_set then
      perform private.lock_draft_practice(new.learner_id, new_practice_set);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function private.validate_attempt_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_practice_set uuid;
  target_source_id uuid;
  target_source_revision text;
begin
  select practice.id, practice.source_conversation_id, practice.source_revision
  into target_practice_set, target_source_id, target_source_revision
  from public.scenarios scenario
  join public.practice_sets practice
    on practice.learner_id = scenario.learner_id and practice.id = scenario.practice_set_id
  where scenario.learner_id = new.learner_id
    and scenario.id = new.scenario_id
    and scenario.source_revision = new.source_revision
    and practice.instruction_revision = new.instruction_revision;

  if not found then
    raise exception using errcode = '23514', message = 'practice set does not accept attempts';
  end if;

  perform private.lock_source_processable(
    new.learner_id,
    target_source_id,
    target_source_revision
  );

  perform 1
  from public.practice_sets practice
  where practice.learner_id = new.learner_id
    and practice.id = target_practice_set
    and practice.status in ('ready', 'inProgress')
  for share;

  if not found then
    raise exception using errcode = '23514', message = 'practice set does not accept attempts';
  end if;

  return new;
end;
$$;

create function private.prevent_attempt_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'attempt audit records are immutable';
end;
$$;

create function private.validate_attempt_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_learner_id uuid;
  target_attempt_id uuid;
  target_scenario_id uuid;
  target_result text;
  expected_rule_count integer;
  actual_result_count integer;
  missed_result_count integer;
begin
  target_learner_id := new.learner_id;
  if tg_table_name = 'attempts' then
    target_attempt_id := new.id;
  else
    target_attempt_id := new.attempt_id;
  end if;

  select attempt.scenario_id, attempt.result
  into target_scenario_id, target_result
  from public.attempts attempt
  where attempt.learner_id = target_learner_id
    and attempt.id = target_attempt_id;

  if not found then
    return null;
  end if;

  select count(*)::integer
  into expected_rule_count
  from public.scenario_rules rule
  where rule.learner_id = target_learner_id
    and rule.scenario_id = target_scenario_id;

  select
    count(*)::integer,
    count(*) filter (where result.disposition = 'missed')::integer
  into actual_result_count, missed_result_count
  from public.attempt_rule_results result
  where result.learner_id = target_learner_id
    and result.attempt_id = target_attempt_id;

  if actual_result_count <> expected_rule_count
    or exists (
      select 1
      from public.scenario_rules rule
      left join public.attempt_rule_results result
        on result.learner_id = rule.learner_id
       and result.attempt_id = target_attempt_id
       and result.scenario_id = rule.scenario_id
       and result.instruction_id = rule.instruction_id
       and result.position = rule.position
      where rule.learner_id = target_learner_id
        and rule.scenario_id = target_scenario_id
        and result.attempt_id is null
    ) then
    raise exception using
      errcode = '23514',
      message = 'attempt rule results must exactly partition scenario rules';
  end if;

  if target_result = 'covered' and missed_result_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'covered attempts require every rule to be matched';
  end if;

  if target_result in ('partial', 'missed') and missed_result_count = 0 then
    raise exception using
      errcode = '23514',
      message = 'partial and missed attempts require at least one missed rule';
  end if;

  return null;
end;
$$;

create function private.prevent_attempt_rule_result_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'attempt rule results are immutable';
end;
$$;

create function private.confirm_change(p_learner_id uuid, p_change_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.change_proposals%rowtype;
  stale_ids uuid[];
  source_record record;
begin
  select * into proposal
  from public.change_proposals
  where learner_id = p_learner_id and id = p_change_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'change proposal not found';
  end if;
  if proposal.status <> 'needsReview' then
    raise exception using errcode = '23514', message = 'change proposal is not reviewable';
  end if;

  for source_record in
    select instruction.source_conversation_id, instruction.source_revision, instruction.id
    from public.instructions instruction
    where instruction.learner_id = proposal.learner_id
      and instruction.id in (
        proposal.previous_instruction_id,
        proposal.replacement_instruction_id
      )
    order by instruction.source_conversation_id, instruction.id
  loop
    perform private.lock_source_processable(
      proposal.learner_id,
      source_record.source_conversation_id,
      source_record.source_revision
    );
  end loop;

  perform 1
  from public.instructions instruction
  where instruction.learner_id = proposal.learner_id
    and instruction.id in (
      proposal.previous_instruction_id,
      proposal.replacement_instruction_id
    )
  order by instruction.id
  for update;

  if not exists (
    select 1
    from public.instructions instruction
    join public.source_conversations source
      on source.learner_id = instruction.learner_id
     and source.id = instruction.source_conversation_id
    where instruction.learner_id = proposal.learner_id
      and instruction.id in (proposal.previous_instruction_id, proposal.replacement_instruction_id)
      and source.consent_status = 'confirmed'
      and source.status = 'ready'
    group by instruction.learner_id
    having count(*) = 2
  ) then
    raise exception using errcode = '23514', message = 'source is not processable';
  end if;

  select coalesce(array_agg(distinct practice.id order by practice.id), array[]::uuid[])
  into stale_ids
  from public.practice_sets practice
  join public.practice_set_instructions link
    on link.learner_id = practice.learner_id and link.practice_set_id = practice.id
  where practice.learner_id = proposal.learner_id
    and link.instruction_id = proposal.previous_instruction_id
    and practice.status <> 'stale';

  perform pg_catalog.set_config('firstday.change_confirmation', proposal.id::text, true);

  update public.instructions
  set status = 'changed'
  where learner_id = proposal.learner_id and id = proposal.previous_instruction_id;

  update public.instructions
  set status = 'confirmed'
  where learner_id = proposal.learner_id and id = proposal.replacement_instruction_id;

  update public.change_proposals
  set status = 'confirmed'
  where learner_id = proposal.learner_id and id = proposal.id;

  update public.practice_sets practice
  set status = 'stale', updated_at = statement_timestamp()
  where practice.learner_id = proposal.learner_id
    and practice.id = any(stale_ids);

  perform pg_catalog.set_config('firstday.change_confirmation', '', true);

  return stale_ids;
end;
$$;

create function private.revoke_source_consent(
  p_learner_id uuid,
  p_source_conversation_id uuid,
  p_source_revision text,
  p_reason text
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale_ids uuid[];
begin
  if p_reason is not null
    and (char_length(p_reason) > 4000 or char_length(btrim(p_reason)) = 0) then
    raise exception using errcode = '23514', message = 'invalid consent revocation reason';
  end if;

  perform 1
  from public.source_conversations source
  where source.learner_id = p_learner_id
    and source.id = p_source_conversation_id
    and source.source_revision = p_source_revision
    and source.consent_status = 'confirmed'
  for update;

  if not found then
    raise exception using errcode = '23514', message = 'source cannot be revoked from its current state';
  end if;

  select coalesce(array_agg(distinct practice.id order by practice.id), array[]::uuid[])
  into stale_ids
  from public.practice_sets practice
  where practice.learner_id = p_learner_id
    and practice.status <> 'stale'
    and (
      practice.source_conversation_id = p_source_conversation_id
      or exists (
        select 1
        from public.practice_set_instructions link
        join public.instructions instruction
          on instruction.learner_id = link.learner_id and instruction.id = link.instruction_id
        where link.learner_id = practice.learner_id
          and link.practice_set_id = practice.id
          and instruction.source_conversation_id = p_source_conversation_id
      )
    );

  perform pg_catalog.set_config('firstday.consent_reason', coalesce(p_reason, ''), true);

  update public.source_conversations
  set consent_status = 'revoked'
  where learner_id = p_learner_id
    and id = p_source_conversation_id
    and source_revision = p_source_revision
    and consent_status = 'confirmed';

  if not found then
    raise exception using errcode = '23514', message = 'source cannot be revoked from its current state';
  end if;

  perform pg_catalog.set_config('firstday.consent_reason', '', true);

  return stale_ids;
end;
$$;

create index instruction_revisions_previous_idx
  on public.instruction_revisions (learner_id, previous_revision_id)
  where previous_revision_id is not null;
create index source_evidence_source_range_idx
  on public.source_evidence (learner_id, source_conversation_id, source_revision, start_ms, end_ms);
create index instructions_snapshot_idx
  on public.instructions (
    learner_id, instruction_revision_id, source_conversation_id, source_revision
  );
create index instructions_source_status_idx
  on public.instructions (learner_id, source_conversation_id, source_revision, status);
create index instructions_supersedes_idx
  on public.instructions (learner_id, supersedes_id)
  where supersedes_id is not null;
create index instruction_evidence_instruction_idx
  on public.instruction_evidence (
    learner_id, instruction_id, source_conversation_id, source_revision
  );
create index instruction_evidence_evidence_idx
  on public.instruction_evidence (
    learner_id, evidence_id, source_conversation_id, source_revision
  );
create index change_proposals_previous_idx
  on public.change_proposals (learner_id, previous_instruction_id, previous_source_revision, status);
create index change_proposals_replacement_idx
  on public.change_proposals (learner_id, replacement_instruction_id, source_revision);
create index practice_sets_source_status_idx
  on public.practice_sets (learner_id, source_conversation_id, source_revision, status);
create index practice_sets_revision_idx
  on public.practice_sets (
    learner_id, instruction_revision_id, source_conversation_id,
    source_revision, instruction_revision
  );
create index practice_sets_change_idx
  on public.practice_sets (learner_id, change_proposal_id, source_revision)
  where change_proposal_id is not null;
create index practice_set_instructions_instruction_idx
  on public.practice_set_instructions (learner_id, instruction_id, instruction_source_revision);
create index scenarios_practice_idx
  on public.scenarios (learner_id, practice_set_id, source_revision, kind, ordering);
create index scenario_rules_instruction_idx
  on public.scenario_rules (learner_id, instruction_id, instruction_source_revision);
create index scenario_evidence_evidence_idx
  on public.scenario_evidence (
    learner_id, evidence_id, source_conversation_id, source_revision
  );
create index attempts_scenario_created_idx
  on public.attempts (learner_id, scenario_id, source_revision, created_at);
create index attempt_rule_results_attempt_idx
  on public.attempt_rule_results (learner_id, attempt_id, scenario_id);
create index attempt_rule_results_scenario_rule_idx
  on public.attempt_rule_results (learner_id, scenario_id, instruction_id);
create index open_questions_source_status_idx
  on public.open_questions (learner_id, source_conversation_id, source_revision, status);
create index open_questions_instruction_idx
  on public.open_questions (
    learner_id, instruction_id, source_conversation_id, source_revision
  )
  where instruction_id is not null;
create index open_question_evidence_evidence_idx
  on public.open_question_evidence (
    learner_id, evidence_id, source_conversation_id, source_revision
  );
create index open_question_evidence_question_idx
  on public.open_question_evidence (
    learner_id, open_question_id, source_conversation_id, source_revision
  );
create index extraction_inputs_source_idx
  on private.extraction_inputs (learner_id, source_conversation_id, source_revision);
create index extraction_inputs_revision_idx
  on private.extraction_inputs (
    learner_id, instruction_revision_id, source_conversation_id, source_revision
  );
create index consent_events_source_time_idx
  on private.consent_events (
    learner_id, source_conversation_id, source_revision, occurred_at desc
  );

create trigger source_conversations_10_validate
before insert or update on public.source_conversations
for each row execute function private.validate_source_conversation_mutation();

create trigger source_conversations_90_audit_consent
after insert or update of consent_status on public.source_conversations
for each row execute function private.audit_source_consent();

create trigger instruction_revisions_10_source_processable
before insert or update on public.instruction_revisions
for each row execute function private.assert_source_processable();

create trigger instruction_revisions_20_immutable
before update on public.instruction_revisions
for each row execute function private.prevent_instruction_revision_mutation();

create trigger source_evidence_10_source_processable
before insert or update on public.source_evidence
for each row execute function private.assert_source_processable();

create trigger source_evidence_20_reviewed_immutable
before update on public.source_evidence
for each row execute function private.guard_reviewed_source_evidence();

create trigger instructions_10_source_processable
before insert or update on public.instructions
for each row execute function private.assert_source_processable();

create trigger instructions_20_validate
before insert or update on public.instructions
for each row execute function private.validate_instruction_mutation();

create trigger instruction_evidence_10_source_processable
before insert or update on public.instruction_evidence
for each row execute function private.assert_source_processable();

create trigger instruction_evidence_20_reviewable
before insert or update or delete on public.instruction_evidence
for each row execute function private.guard_instruction_evidence_mutation();

create trigger change_proposals_10_validate
before insert or update on public.change_proposals
for each row execute function private.validate_change_proposal_mutation();

create trigger practice_sets_10_validate
before insert or update on public.practice_sets
for each row execute function private.validate_practice_set_mutation();

create trigger practice_set_instructions_10_draft
before insert or update or delete on public.practice_set_instructions
for each row execute function private.guard_practice_child('direct');

create trigger scenarios_10_draft
before insert or update or delete on public.scenarios
for each row execute function private.guard_practice_child('direct');

create trigger scenario_rules_10_draft
before insert or update or delete on public.scenario_rules
for each row execute function private.guard_practice_child('scenario');

create trigger scenario_evidence_10_draft
before insert or update or delete on public.scenario_evidence
for each row execute function private.guard_practice_child('scenario');

create trigger attempts_10_validate_insert
before insert on public.attempts
for each row execute function private.validate_attempt_insert();

create trigger attempts_20_immutable
before update or delete on public.attempts
for each row execute function private.prevent_attempt_mutation();

create constraint trigger attempts_90_integrity
after insert on public.attempts
deferrable initially deferred
for each row execute function private.validate_attempt_integrity();

create trigger attempt_rule_results_20_immutable
before update or delete on public.attempt_rule_results
for each row execute function private.prevent_attempt_rule_result_mutation();

create constraint trigger attempt_rule_results_90_integrity
after insert on public.attempt_rule_results
deferrable initially deferred
for each row execute function private.validate_attempt_integrity();

create trigger open_questions_10_source_processable
before insert or update on public.open_questions
for each row execute function private.assert_source_processable();

create trigger open_questions_20_validate
before insert or update on public.open_questions
for each row execute function private.validate_open_question_mutation();

create trigger open_question_evidence_10_source_processable
before insert or update on public.open_question_evidence
for each row execute function private.assert_source_processable();

create trigger open_question_evidence_20_open
before insert or update or delete on public.open_question_evidence
for each row execute function private.guard_open_question_evidence_mutation();

create trigger source_materials_10_validate
before insert or update on private.source_materials
for each row execute function private.validate_source_material();

create trigger extraction_inputs_10_source_processable
before insert or update on private.extraction_inputs
for each row execute function private.assert_source_processable();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'source_conversations',
    'instruction_revisions',
    'source_evidence',
    'instructions',
    'instruction_evidence',
    'change_proposals',
    'practice_sets',
    'practice_set_instructions',
    'scenarios',
    'scenario_rules',
    'scenario_evidence',
    'attempts',
    'attempt_rule_results',
    'open_questions',
    'open_question_evidence'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = learner_id)',
      table_name || '_own_select',
      table_name
    );
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end;
$$;

grant usage on schema public to authenticated, service_role;

revoke all on table private.source_materials from public, anon, authenticated, service_role;
revoke all on table private.extraction_inputs from public, anon, authenticated, service_role;
revoke all on table private.consent_events from public, anon, authenticated, service_role;
grant select, insert on table private.source_materials to service_role;
grant select, insert on table private.extraction_inputs to service_role;
grant select, insert on table private.consent_events to service_role;

revoke execute on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.is_text_array(jsonb, integer, integer, integer, boolean) to service_role;
grant execute on function private.lock_source_processable(uuid, uuid, text) to service_role;
grant execute on function private.lock_draft_practice(uuid, uuid) to service_role;
grant execute on function private.practice_progress(uuid, uuid) to service_role;
grant execute on function private.assert_practice_set_ready(uuid, uuid) to service_role;
grant execute on function private.confirm_change(uuid, uuid) to service_role;
grant execute on function private.revoke_source_consent(uuid, uuid, text, text) to service_role;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
