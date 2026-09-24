begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(56);

insert into auth.users (id, email)
values
  ('11000000-0000-4000-8000-000000000001', 'invariants-one@example.test'),
  ('11000000-0000-4000-8000-000000000002', 'invariants-two@example.test');

insert into public.source_conversations (
  id, learner_id, bee_source_id, source_kind, title, started_at,
  transcript_hash, source_revision, consent_status, consent_confirmed_at, status
)
values
  (
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'fixture-main', 'fixture', 'Main onboarding', '2026-09-10T16:00:00Z',
    encode(extensions.digest(convert_to('Main transcript', 'UTF8'), 'sha256'), 'hex'),
    'main-r1', 'confirmed', '2026-09-10T16:01:00Z', 'ready'
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001',
    'fixture-old', 'fixture', 'Old policy', '2026-09-11T16:00:00Z',
    encode(extensions.digest(convert_to('Old transcript', 'UTF8'), 'sha256'), 'hex'),
    'old-r1', 'confirmed', '2026-09-11T16:01:00Z', 'ready'
  ),
  (
    '21000000-0000-4000-8000-000000000003',
    '11000000-0000-4000-8000-000000000001',
    'fixture-new', 'fixture', 'New policy', '2026-09-12T16:00:00Z',
    encode(extensions.digest(convert_to('New transcript', 'UTF8'), 'sha256'), 'hex'),
    'new-r1', 'confirmed', '2026-09-12T16:01:00Z', 'ready'
  ),
  (
    '21000000-0000-4000-8000-000000000004',
    '11000000-0000-4000-8000-000000000001',
    'fixture-collision', 'fixture', 'Colliding revision', '2026-09-12T17:00:00Z',
    encode(extensions.digest(convert_to('Collision transcript', 'UTF8'), 'sha256'), 'hex'),
    'new-r1', 'confirmed', '2026-09-12T17:01:00Z', 'ready'
  );

select throws_ok(
  $$insert into public.source_conversations (
      learner_id, bee_source_id, source_kind, title, started_at,
      transcript_hash, source_revision, consent_status, consent_confirmed_at, status
    ) values (
      '11000000-0000-4000-8000-000000000001', 'fixture-main', 'fixture',
      'Conflicting replay', '2026-09-10T16:00:00Z', repeat('f', 64), 'main-r1',
      'confirmed', '2026-09-10T16:01:00Z', 'ready'
    )$$,
  '23505',
  'duplicate key value violates unique constraint "source_conversations_source_identity_key"',
  'one learner/source-kind/Bee-ID/revision identity cannot accept another transcript hash'
);

insert into public.source_evidence (
  id, learner_id, source_conversation_id, source_revision,
  start_ms, end_ms, quote, utterance_ids, speaker_label
)
select
  'evd_' || encode(extensions.digest(convert_to(
    '21000000-0000-4000-8000-000000000001' || E'\nmain-r1\n100\n200',
    'UTF8'
  ), 'sha256'), 'hex'),
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'main-r1', 100, 200, 'Main evidence', '["utt-main"]'::jsonb, 'trainer';

select throws_ok(
  $$insert into public.source_evidence (
      id, learner_id, source_conversation_id, source_revision,
      start_ms, end_ms, quote, utterance_ids
    ) values (
      'evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      'main-r1', 201, 300, 'Wrong digest', '["utt-wrong"]'::jsonb
    )$$,
  '23514',
  'new row for relation "source_evidence" violates check constraint "source_evidence_digest_check"',
  'source evidence rejects a well-formed but incorrect digest'
);
select throws_ok(
  $$insert into public.source_evidence (
      id, learner_id, source_conversation_id, source_revision,
      start_ms, end_ms, quote, utterance_ids
    ) values (
      'evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '11000000-0000-4000-8000-000000000002',
      '21000000-0000-4000-8000-000000000001',
      'main-r1', 100, 200, 'Cross learner', '["utt-cross"]'::jsonb
    )$$,
  '23514',
  'source is not processable',
  'cross-learner source evidence is rejected'
);

insert into public.instruction_revisions (
  id, learner_id, source_conversation_id, source_revision, revision, previous_revision_id
)
values
  (
    '31000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001', 'main-r1', 'instructions-main-r1', null
  ),
  (
    '31000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000002', 'old-r1', 'instructions-old-r1', null
  ),
  (
    '31000000-0000-4000-8000-000000000003',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000003', 'new-r1', 'instructions-new-r1',
    '31000000-0000-4000-8000-000000000002'
  ),
  (
    '31000000-0000-4000-8000-000000000004',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000004', 'new-r1', 'instructions-new-r1', null
  );

insert into public.instructions (
  id, learner_id, source_conversation_id, source_revision, instruction_revision_id,
  text, situation, expected_action, exceptions, confidence, status
)
values
  ('41000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'main-r1', '31000000-0000-4000-8000-000000000001', 'Rule one', 'Situation one', 'Action one', '[]', 0.99, 'needsReview'),
  ('41000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'main-r1', '31000000-0000-4000-8000-000000000001', 'Rule two', 'Situation two', 'Action two', '[]', 0.98, 'needsReview'),
  ('41000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'main-r1', '31000000-0000-4000-8000-000000000001', 'Rule three', 'Situation three', 'Action three', '[]', 0.97, 'needsReview');

insert into public.instruction_evidence (
  learner_id, instruction_id, source_conversation_id, source_revision, evidence_id, position
)
select
  '11000000-0000-4000-8000-000000000001',
  instruction_id,
  '21000000-0000-4000-8000-000000000001',
  'main-r1',
  (select id from public.source_evidence where source_conversation_id = '21000000-0000-4000-8000-000000000001'),
  1
from unnest(array[
  '41000000-0000-4000-8000-000000000001'::uuid,
  '41000000-0000-4000-8000-000000000002'::uuid,
  '41000000-0000-4000-8000-000000000003'::uuid
]) as ids(instruction_id);

select lives_ok(
  $$update public.instructions
    set text = 'Edited rule one'
    where id = '41000000-0000-4000-8000-000000000001'$$,
  'instruction content can be edited while needsReview'
);
select lives_ok(
  $$update public.instructions set status = 'confirmed'
    where id in (
      '41000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000002',
      '41000000-0000-4000-8000-000000000003'
    )$$,
  'review cards with evidence can be confirmed'
);
select is(
  (
    select count(distinct instruction_revision_id)::integer
    from public.instructions
    where id in (
      '41000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000002',
      '41000000-0000-4000-8000-000000000003'
    )
  ),
  1,
  'ordinary review decisions preserve the extraction snapshot revision'
);
select throws_ok(
  $$update public.instructions
    set text = 'Tampered after review'
    where id = '41000000-0000-4000-8000-000000000001'$$,
  '23514',
  'reviewed instruction content and provenance are immutable',
  'confirmed instruction content cannot be edited'
);
select throws_ok(
  $$update public.instructions
    set status = 'changed'
    where id = '41000000-0000-4000-8000-000000000001'$$,
  '23514',
  'confirmed instructions can change only through controlled change confirmation',
  'confirmed to changed is not a normal instruction update'
);
select throws_ok(
  $$update public.instruction_evidence
    set position = 2
    where instruction_id = '41000000-0000-4000-8000-000000000001'$$,
  '23514',
  'reviewed instruction evidence is immutable',
  'confirmed instruction evidence links cannot be edited'
);

insert into public.open_questions (
  id, learner_id, source_conversation_id, source_revision, instruction_id,
  question, status, share_consent
)
values (
  '81000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001', 'main-r1',
  '41000000-0000-4000-8000-000000000001',
  'What happens on holidays?', 'open', false
);
insert into public.open_question_evidence (
  learner_id, open_question_id, source_conversation_id, source_revision, evidence_id, position
)
select
  '11000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001', 'main-r1', id, 1
from public.source_evidence
where source_conversation_id = '21000000-0000-4000-8000-000000000001';
select lives_ok(
  $$update public.open_questions
    set status = 'resolved', resolution = 'Ask the shift lead.'
    where id = '81000000-0000-4000-8000-000000000001'$$,
  'an open question can be resolved'
);
select throws_ok(
  $$update public.open_questions
    set question = 'Edited after resolution'
    where id = '81000000-0000-4000-8000-000000000001'$$,
  '23514',
  'resolved and dismissed questions are terminal',
  'resolved questions cannot be edited'
);
select throws_ok(
  $$update public.open_question_evidence
    set position = 2
    where open_question_id = '81000000-0000-4000-8000-000000000001'$$,
  '23514',
  'resolved and dismissed question evidence is immutable',
  'resolved question evidence links cannot be edited'
);

select lives_ok(
  $$insert into private.source_materials (
      learner_id, source_conversation_id, source_revision, transcript, utterances
    ) values (
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001', 'main-r1',
      'Main transcript', '[{"id":"utt-main","startMs":100,"endMs":200,"text":"Main evidence"}]'
    )$$,
  'private source material accepts the exact consented transcript'
);
select lives_ok(
  $$insert into private.extraction_inputs (
      learner_id, source_conversation_id, source_revision, instruction_revision_id,
      payload, excluded_ranges
    ) values (
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001', 'main-r1',
      '31000000-0000-4000-8000-000000000001',
      '{"transcript":"Main transcript"}', '[]'
    )$$,
  'private extraction input accepts a consented source snapshot'
);

insert into public.practice_sets (
  id, learner_id, source_conversation_id, source_revision, source_kind, title,
  kind, instruction_revision_id, instruction_revision, status
)
values (
  '51000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001', 'main-r1', 'fixture',
  'Main practice', 'standard', '31000000-0000-4000-8000-000000000001',
  'instructions-main-r1', 'draft'
);
insert into public.practice_set_instructions (
  learner_id, practice_set_id, instruction_id, instruction_source_revision, position
)
select
  '11000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', instruction_id, 'main-r1', position
from unnest(array[
  '41000000-0000-4000-8000-000000000001'::uuid,
  '41000000-0000-4000-8000-000000000002'::uuid,
  '41000000-0000-4000-8000-000000000003'::uuid
]) with ordinality as ids(instruction_id, position);
insert into public.scenarios (
  id, learner_id, practice_set_id, source_revision, kind, character_id,
  prompt, context, acceptable_signals, critical_misses, retry_prompt, ordering
)
select
  scenario_id, '11000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001', 'main-r1', 'standard',
  'customer-rowan', 'Prompt ' || ordering, 'Context ' || ordering,
  jsonb_build_array('signal ' || ordering), '[]'::jsonb,
  'Retry ' || ordering, ordering
from unnest(array[
  '61000000-0000-4000-8000-000000000001'::uuid,
  '61000000-0000-4000-8000-000000000002'::uuid,
  '61000000-0000-4000-8000-000000000003'::uuid
]) with ordinality as ids(scenario_id, ordering);
insert into public.scenario_rules (learner_id, scenario_id, instruction_id, instruction_source_revision, position)
select
  '11000000-0000-4000-8000-000000000001', scenario_id, instruction_id, 'main-r1', 1
from unnest(
  array[
    '61000000-0000-4000-8000-000000000001'::uuid,
    '61000000-0000-4000-8000-000000000002'::uuid,
    '61000000-0000-4000-8000-000000000003'::uuid
  ],
  array[
    '41000000-0000-4000-8000-000000000001'::uuid,
    '41000000-0000-4000-8000-000000000002'::uuid,
    '41000000-0000-4000-8000-000000000003'::uuid
  ]
) with ordinality as ids(scenario_id, instruction_id, ordering);
insert into public.scenario_evidence (
  learner_id, scenario_id, source_conversation_id, source_revision, evidence_id, position
)
select
  '11000000-0000-4000-8000-000000000001', scenario_id,
  '21000000-0000-4000-8000-000000000001', 'main-r1',
  (select id from public.source_evidence where source_conversation_id = '21000000-0000-4000-8000-000000000001'),
  1
from unnest(array[
  '61000000-0000-4000-8000-000000000001'::uuid,
  '61000000-0000-4000-8000-000000000002'::uuid,
  '61000000-0000-4000-8000-000000000003'::uuid
]) as ids(scenario_id);

select throws_ok(
  $$update public.practice_sets set status = 'complete'
    where id = '51000000-0000-4000-8000-000000000001'$$,
  '23514',
  'invalid practice-set state transition',
  'a draft practice set cannot become complete directly'
);
select lives_ok(
  $$update public.practice_sets set status = 'ready'
    where id = '51000000-0000-4000-8000-000000000001'$$,
  'a fully grounded three-scenario standard set can become ready'
);

select throws_ok(
  $test$do $block$
  begin
    insert into public.attempts (
      id, learner_id, scenario_id, source_revision, instruction_revision,
      response_text, input_mode, result, feedback
    ) values (
      '71000000-0000-4000-8000-000000000010',
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      'main-r1', 'instructions-main-r1', 'No rule results', 'text', 'covered', 'Invalid.'
    );
    set constraints all immediate;
    raise exception using errcode = 'P0001', message = 'parent-only attempt unexpectedly passed';
  end
  $block$$test$,
  '23514',
  'attempt rule results must exactly partition scenario rules',
  'an attempt cannot commit without its complete rule-result partition'
);
select throws_ok(
  $test$do $block$
  begin
    insert into public.attempts (
      id, learner_id, scenario_id, source_revision, instruction_revision,
      response_text, input_mode, result, feedback
    ) values (
      '71000000-0000-4000-8000-000000000011',
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      'main-r1', 'instructions-main-r1', 'Claims covered', 'text', 'covered', 'Invalid.'
    );
    insert into public.attempt_rule_results (
      learner_id, attempt_id, scenario_id, instruction_id, disposition, position
    ) values (
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000011',
      '61000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000001', 'missed', 1
    );
    set constraints all immediate;
    raise exception using errcode = 'P0001', message = 'covered/missed attempt unexpectedly passed';
  end
  $block$$test$,
  '23514',
  'covered attempts require every rule to be matched',
  'covered is rejected when any expected rule was missed'
);
select throws_ok(
  $test$do $block$
  begin
    insert into public.attempts (
      id, learner_id, scenario_id, source_revision, instruction_revision,
      response_text, input_mode, result, feedback
    ) values (
      '71000000-0000-4000-8000-000000000012',
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      'main-r1', 'instructions-main-r1', 'Claims partial', 'text', 'partial', 'Invalid.'
    );
    insert into public.attempt_rule_results (
      learner_id, attempt_id, scenario_id, instruction_id, disposition, position
    ) values (
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000012',
      '61000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000001', 'matched', 1
    );
    set constraints all immediate;
    raise exception using errcode = 'P0001', message = 'partial/all-matched attempt unexpectedly passed';
  end
  $block$$test$,
  '23514',
  'partial and missed attempts require at least one missed rule',
  'partial is rejected when every expected rule matched'
);
select throws_ok(
  $test$do $block$
  begin
    insert into public.attempts (
      id, learner_id, scenario_id, source_revision, instruction_revision,
      response_text, input_mode, result, feedback
    ) values (
      '71000000-0000-4000-8000-000000000013',
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      'main-r1', 'instructions-main-r1', 'Extra rule', 'text', 'needsReview', 'Review.'
    );
    insert into public.attempt_rule_results (
      learner_id, attempt_id, scenario_id, instruction_id, disposition, position
    ) values (
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000013',
      '61000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000002', 'matched', 1
    );
  end
  $block$$test$,
  '23503',
  'insert or update on table "attempt_rule_results" violates foreign key constraint "attempt_rule_results_scenario_rule_fkey"',
  'an attempt cannot contain a result for a rule outside its scenario'
);
select lives_ok(
  $test$do $block$
  begin
    insert into public.attempts (
      id, learner_id, scenario_id, source_revision, instruction_revision,
      response_text, input_mode, result, feedback
    ) values (
      '71000000-0000-4000-8000-000000000014',
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      'main-r1', 'instructions-main-r1', 'Review this answer', 'text', 'needsReview', 'Review.'
    );
    insert into public.attempt_rule_results (
      learner_id, attempt_id, scenario_id, instruction_id, disposition, position
    ) values (
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000014',
      '61000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000001', 'matched', 1
    );
    set constraints all immediate;
    set constraints all deferred;
  end
  $block$$test$,
  'needsReview remains valid when it carries the complete rule partition'
);
select throws_ok(
  $test$do $block$
  begin
    update public.attempt_rule_results
    set disposition = 'missed'
    where attempt_id = '71000000-0000-4000-8000-000000000014';
    raise exception using errcode = 'P0001', message = 'attempt rule-result update unexpectedly passed';
  end
  $block$$test$,
  '23514',
  'attempt rule results are immutable',
  'attempt rule-result audit rows cannot be updated'
);
select throws_ok(
  $test$do $block$
  begin
    delete from public.attempt_rule_results
    where attempt_id = '71000000-0000-4000-8000-000000000014';
    raise exception using errcode = 'P0001', message = 'attempt rule-result delete unexpectedly passed';
  end
  $block$$test$,
  '23514',
  'attempt rule results are immutable',
  'attempt rule-result audit rows cannot be deleted'
);

insert into public.attempts (
  id, learner_id, scenario_id, source_revision, instruction_revision,
  response_text, input_mode, result, feedback
)
values
  ('71000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'main-r1', 'instructions-main-r1', 'First covered answer', 'text', 'covered', 'Covered.'),
  ('71000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'main-r1', 'instructions-main-r1', 'Covered retry', 'voice', 'covered', 'Covered again.');
insert into public.attempt_rule_results (learner_id, attempt_id, scenario_id, instruction_id, disposition, position)
values
  ('11000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'matched', 1),
  ('11000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'matched', 1);
set constraints all immediate;
set constraints all deferred;
select lives_ok(
  $$update public.practice_sets set status = 'inProgress'
    where id = '51000000-0000-4000-8000-000000000001'$$,
  'a ready practice set can enter progress'
);
select is(
  (
    select completed
    from private.practice_progress(
      '11000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'progress counts a covered scenario once even when it has covered retries'
);

insert into public.attempts (
  id, learner_id, scenario_id, source_revision, instruction_revision,
  response_text, input_mode, result, feedback
)
values
  ('71000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 'main-r1', 'instructions-main-r1', 'Second covered answer', 'text', 'covered', 'Covered.'),
  ('71000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000003', 'main-r1', 'instructions-main-r1', 'Third covered answer', 'text', 'covered', 'Covered.');
insert into public.attempt_rule_results (learner_id, attempt_id, scenario_id, instruction_id, disposition, position)
values
  ('11000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', 'matched', 1),
  ('11000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000004', '61000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000003', 'matched', 1);
set constraints all immediate;
set constraints all deferred;
select lives_ok(
  $$update public.practice_sets set status = 'complete'
    where id = '51000000-0000-4000-8000-000000000001'$$,
  'a practice set can complete after every distinct scenario is covered'
);
select throws_ok(
  $$update public.practice_sets set status = 'stale'
    where id = '51000000-0000-4000-8000-000000000001'$$,
  '23514',
  'invalid practice-set state transition',
  'practice cannot become stale without revocation or confirmed source change'
);

select lives_ok(
  $$select private.revoke_source_consent(
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      'main-r1',
      'Learner revoked this source.'
    )$$,
  'controlled revocation succeeds atomically'
);
select is(
  (
    (select count(*) from private.source_materials where source_conversation_id = '21000000-0000-4000-8000-000000000001')
    +
    (select count(*) from private.extraction_inputs where source_conversation_id = '21000000-0000-4000-8000-000000000001')
  )::integer,
  0,
  'revocation deletes raw source and extraction material'
);
select is(
  (select consent_status from public.source_conversations where id = '21000000-0000-4000-8000-000000000001'),
  'revoked',
  'revocation retains compact source audit metadata'
);
select is(
  (select status from public.practice_sets where id = '51000000-0000-4000-8000-000000000001'),
  'stale',
  'revocation stales a completed affected practice set'
);
select is(
  (
    (select count(*) from public.instructions where source_conversation_id = '21000000-0000-4000-8000-000000000001')
    +
    (select count(*) from public.attempts where learner_id = '11000000-0000-4000-8000-000000000001')
  )::integer,
  8,
  'revocation retains compact instruction and attempt audit rows'
);
select is(
  (
    select reason
    from private.consent_events
    where source_conversation_id = '21000000-0000-4000-8000-000000000001'
      and consent_status = 'revoked'
    order by occurred_at desc
    limit 1
  ),
  'Learner revoked this source.',
  'revocation records its private consent audit reason'
);
select throws_ok(
  $$insert into private.source_materials (
      learner_id, source_conversation_id, source_revision, transcript, utterances
    ) values (
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001', 'main-r1',
      'Main transcript', '[]'
    )$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future raw material writes'
);
select throws_ok(
  $$insert into private.extraction_inputs (
      learner_id, source_conversation_id, source_revision, instruction_revision_id,
      payload, excluded_ranges
    ) values (
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001', 'main-r1',
      '31000000-0000-4000-8000-000000000001', '{}', '[]'
    )$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future extraction input writes'
);
select throws_ok(
  $$insert into public.instruction_revisions (
      learner_id, source_conversation_id, source_revision, revision
    ) values (
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001', 'main-r1', 'blocked-r2'
    )$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future derived processing records'
);
select throws_ok(
  $$insert into public.source_evidence (
      id, learner_id, source_conversation_id, source_revision,
      start_ms, end_ms, quote, utterance_ids
    ) values (
      'evd_' || encode(extensions.digest(convert_to(
        '21000000-0000-4000-8000-000000000001' || E'\nmain-r1\n300\n400',
        'UTF8'
      ), 'sha256'), 'hex'),
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001', 'main-r1',
      300, 400, 'Late evidence', '["utt-late"]'
    )$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future evidence writes'
);
select throws_ok(
  $$insert into public.instructions (
      id, learner_id, source_conversation_id, source_revision, instruction_revision_id,
      text, situation, expected_action, exceptions, confidence, status
    ) values (
      '41000000-0000-4000-8000-000000000007',
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001', 'main-r1',
      '31000000-0000-4000-8000-000000000001',
      'Late rule', 'Late situation', 'Late action', '[]', 0.9, 'needsReview'
    )$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future instruction writes'
);
select throws_ok(
  $$update public.instruction_evidence
    set position = 2
    where instruction_id = '41000000-0000-4000-8000-000000000001'$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future instruction-evidence link writes'
);
select throws_ok(
  $$insert into public.open_questions (
      id, learner_id, source_conversation_id, source_revision, instruction_id,
      question, status, share_consent
    ) values (
      '81000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001', 'main-r1',
      '41000000-0000-4000-8000-000000000001',
      'Can this be processed later?', 'open', false
    )$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future question writes'
);
select throws_ok(
  $$update public.open_question_evidence
    set position = 2
    where open_question_id = '81000000-0000-4000-8000-000000000001'$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future question-evidence link writes'
);
select throws_ok(
  $$insert into public.practice_sets (
      id, learner_id, source_conversation_id, source_revision, source_kind, title,
      kind, instruction_revision_id, instruction_revision, status
    ) values (
      '51000000-0000-4000-8000-000000000005',
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001', 'main-r1', 'fixture',
      'Late practice', 'standard', '31000000-0000-4000-8000-000000000001',
      'instructions-main-r1', 'draft'
    )$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future practice creation'
);
select throws_ok(
  $$update public.scenarios
    set prompt = prompt || ' after revocation'
    where id = '61000000-0000-4000-8000-000000000001'$$,
  '23514',
  'source is not processable',
  'a stale practice cannot receive future child writes'
);
select throws_ok(
  $$insert into public.attempts (
      id, learner_id, scenario_id, source_revision, instruction_revision,
      response_text, input_mode, result, feedback
    ) values (
      '71000000-0000-4000-8000-000000000015',
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      'main-r1', 'instructions-main-r1', 'Late attempt', 'text', 'needsReview', 'Blocked.'
    )$$,
  '23514',
  'source is not processable',
  'revoked consent blocks future attempts'
);

insert into public.source_evidence (
  id, learner_id, source_conversation_id, source_revision,
  start_ms, end_ms, quote, utterance_ids
)
select
  'evd_' || encode(extensions.digest(convert_to(source_id || E'\n' || revision || E'\n100\n200', 'UTF8'), 'sha256'), 'hex'),
  '11000000-0000-4000-8000-000000000001', source_id::uuid, revision,
  100, 200, quote, jsonb_build_array('utt-' || revision)
from (values
  ('21000000-0000-4000-8000-000000000002', 'old-r1', 'Old evidence'),
  ('21000000-0000-4000-8000-000000000003', 'new-r1', 'New evidence'),
  ('21000000-0000-4000-8000-000000000004', 'new-r1', 'Colliding evidence')
) as evidence(source_id, revision, quote);

insert into public.instructions (
  id, learner_id, source_conversation_id, source_revision, instruction_revision_id,
  text, situation, expected_action, exceptions, confidence, status, supersedes_id
)
values
  ('41000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', 'old-r1', '31000000-0000-4000-8000-000000000002', 'Five days', 'Reservation', 'Use five days', '[]', 0.99, 'needsReview', null),
  ('41000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000003', 'new-r1', '31000000-0000-4000-8000-000000000003', 'Seven days', 'Reservation', 'Use seven days', '[]', 0.99, 'needsReview', '41000000-0000-4000-8000-000000000004'),
  ('41000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000004', 'new-r1', '31000000-0000-4000-8000-000000000004', 'Unrelated seven days', 'Reservation', 'Use unrelated rule', '[]', 0.99, 'needsReview', '41000000-0000-4000-8000-000000000004');
insert into public.instruction_evidence (
  learner_id, instruction_id, source_conversation_id, source_revision, evidence_id, position
)
select
  '11000000-0000-4000-8000-000000000001', instruction_id, source_id, revision,
  (select id from public.source_evidence where source_conversation_id = source_id), 1
from (values
  ('41000000-0000-4000-8000-000000000004'::uuid, '21000000-0000-4000-8000-000000000002'::uuid, 'old-r1'),
  ('41000000-0000-4000-8000-000000000005'::uuid, '21000000-0000-4000-8000-000000000003'::uuid, 'new-r1'),
  ('41000000-0000-4000-8000-000000000006'::uuid, '21000000-0000-4000-8000-000000000004'::uuid, 'new-r1')
) as links(instruction_id, source_id, revision);
select lives_ok(
  $$update public.instructions set status = 'confirmed'
    where id = '41000000-0000-4000-8000-000000000004'$$,
  'the prior instruction can be confirmed before comparison'
);

select throws_ok(
  $test$do $block$
  begin
    insert into public.change_proposals (
      id, learner_id, previous_instruction_id, previous_source_revision,
      replacement_instruction_id, source_revision, status
    ) values (
      '91000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000004', 'old-r1',
      '41000000-0000-4000-8000-000000000006', 'new-r1', 'needsReview'
    );
    raise exception using errcode = 'P0001', message = 'unrelated replacement snapshot unexpectedly passed';
  end
  $block$$test$,
  '23514',
  'replacement instruction snapshot must descend from the previous instruction snapshot',
  'a change replacement cannot use a colliding revision from unrelated lineage'
);

insert into public.change_proposals (
  id, learner_id, previous_instruction_id, previous_source_revision,
  replacement_instruction_id, source_revision, status
)
values (
  '91000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000004', 'old-r1',
  '41000000-0000-4000-8000-000000000005', 'new-r1', 'needsReview'
);

insert into public.practice_sets (
  id, learner_id, source_conversation_id, source_revision, source_kind, title,
  kind, instruction_revision_id, instruction_revision, status
)
values (
  '51000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000002', 'old-r1', 'fixture',
  'Old policy practice', 'standard', '31000000-0000-4000-8000-000000000002',
  'instructions-old-r1', 'draft'
);
insert into public.practice_set_instructions (
  learner_id, practice_set_id, instruction_id, instruction_source_revision, position
)
values (
  '11000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000002',
  '41000000-0000-4000-8000-000000000004', 'old-r1', 1
);
insert into public.scenarios (
  id, learner_id, practice_set_id, source_revision, kind, character_id,
  prompt, context, acceptable_signals, critical_misses, retry_prompt, ordering
)
select
  scenario_id, '11000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000002', 'old-r1', 'standard',
  'customer-rowan', 'Old prompt ' || ordering, 'Old context', '["five days"]', '[]',
  'Retry old rule', ordering
from unnest(array[
  '61000000-0000-4000-8000-000000000004'::uuid,
  '61000000-0000-4000-8000-000000000005'::uuid,
  '61000000-0000-4000-8000-000000000006'::uuid
]) with ordinality as ids(scenario_id, ordering);
insert into public.scenario_rules (learner_id, scenario_id, instruction_id, instruction_source_revision, position)
select
  '11000000-0000-4000-8000-000000000001', scenario_id,
  '41000000-0000-4000-8000-000000000004', 'old-r1', 1
from unnest(array[
  '61000000-0000-4000-8000-000000000004'::uuid,
  '61000000-0000-4000-8000-000000000005'::uuid,
  '61000000-0000-4000-8000-000000000006'::uuid
]) as ids(scenario_id);
insert into public.scenario_evidence (
  learner_id, scenario_id, source_conversation_id, source_revision, evidence_id, position
)
select
  '11000000-0000-4000-8000-000000000001', scenario_id,
  '21000000-0000-4000-8000-000000000002', 'old-r1',
  (select id from public.source_evidence where source_conversation_id = '21000000-0000-4000-8000-000000000002'), 1
from unnest(array[
  '61000000-0000-4000-8000-000000000004'::uuid,
  '61000000-0000-4000-8000-000000000005'::uuid,
  '61000000-0000-4000-8000-000000000006'::uuid
]) as ids(scenario_id);
select lives_ok(
  $$update public.practice_sets set status = 'ready'
    where id = '51000000-0000-4000-8000-000000000002'$$,
  'the old revision practice set can become ready'
);
insert into public.attempts (
  id, learner_id, scenario_id, source_revision, instruction_revision,
  response_text, input_mode, result, feedback
)
select
  attempt_id, '11000000-0000-4000-8000-000000000001', scenario_id,
  'old-r1', 'instructions-old-r1', 'Covered old rule', 'text', 'covered', 'Covered.'
from unnest(
  array[
    '71000000-0000-4000-8000-000000000005'::uuid,
    '71000000-0000-4000-8000-000000000006'::uuid,
    '71000000-0000-4000-8000-000000000007'::uuid
  ],
  array[
    '61000000-0000-4000-8000-000000000004'::uuid,
    '61000000-0000-4000-8000-000000000005'::uuid,
    '61000000-0000-4000-8000-000000000006'::uuid
  ]
) as attempts(attempt_id, scenario_id);
insert into public.attempt_rule_results (
  learner_id, attempt_id, scenario_id, instruction_id, disposition, position
)
select
  attempt.learner_id, attempt.id, attempt.scenario_id,
  rule.instruction_id, 'matched', 1
from public.attempts attempt
join public.scenario_rules rule
  on rule.learner_id = attempt.learner_id
 and rule.scenario_id = attempt.scenario_id
where attempt.id in (
  '71000000-0000-4000-8000-000000000005',
  '71000000-0000-4000-8000-000000000006',
  '71000000-0000-4000-8000-000000000007'
);
set constraints all immediate;
set constraints all deferred;
update public.practice_sets set status = 'inProgress'
where id = '51000000-0000-4000-8000-000000000002';
update public.practice_sets set status = 'complete'
where id = '51000000-0000-4000-8000-000000000002';
select throws_ok(
  $$update public.instructions set status = 'changed'
    where id = '41000000-0000-4000-8000-000000000004'$$,
  '23514',
  'confirmed instructions can change only through controlled change confirmation',
  'the previous instruction cannot be changed directly'
);
select throws_ok(
  $$update public.instructions set status = 'confirmed'
    where id = '41000000-0000-4000-8000-000000000005'$$,
  '23514',
  'change replacements can be confirmed only through controlled change confirmation',
  'ordinary instruction review cannot install a proposed replacement'
);
select lives_ok(
  $$select private.confirm_change(
      '11000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001'
    )$$,
  'controlled change confirmation succeeds'
);
select is(
  (
    select concat_ws(',', p.status, old_instruction.status, replacement.status)
    from public.change_proposals p
    join public.instructions old_instruction on old_instruction.id = p.previous_instruction_id
    join public.instructions replacement on replacement.id = p.replacement_instruction_id
    where p.id = '91000000-0000-4000-8000-000000000001'
  ),
  'confirmed,changed,confirmed',
  'change confirmation atomically transitions proposal, previous, and replacement records'
);
select is(
  (select status from public.practice_sets where id = '51000000-0000-4000-8000-000000000002'),
  'stale',
  'confirming a new instruction revision stales complete practice using the previous rule'
);

insert into public.practice_sets (
  id, learner_id, source_conversation_id, source_revision, source_kind, title,
  kind, instruction_revision_id, instruction_revision, change_proposal_id, status
)
values (
  '51000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000003', 'new-r1', 'fixture',
  'Five-to-seven-day change', 'changeDrill',
  '31000000-0000-4000-8000-000000000003', 'instructions-new-r1',
  '91000000-0000-4000-8000-000000000001', 'draft'
);
insert into public.practice_set_instructions (
  learner_id, practice_set_id, instruction_id, instruction_source_revision, position
)
values
  ('11000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000004', 'old-r1', 1),
  ('11000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000003', '41000000-0000-4000-8000-000000000005', 'new-r1', 2);
insert into public.scenarios (
  id, learner_id, practice_set_id, source_revision, kind, character_id,
  prompt, context, acceptable_signals, critical_misses, retry_prompt, ordering
)
values (
  '61000000-0000-4000-8000-000000000007',
  '11000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000003', 'new-r1', 'changeDrill',
  'guide-maya', 'Apply the changed reservation rule', 'The hold changed from five to seven days.',
  '["seven days"]', '["five days"]', 'Use the replacement rule.', 1
);
insert into public.scenario_rules (
  learner_id, scenario_id, instruction_id, instruction_source_revision, position
)
values (
  '11000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000007',
  '41000000-0000-4000-8000-000000000005', 'new-r1', 1
);
insert into public.scenario_evidence (
  learner_id, scenario_id, source_conversation_id, source_revision, evidence_id, position
)
select
  '11000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000007',
  source_conversation_id, source_revision, id,
  row_number() over (order by source_revision)::smallint
from public.source_evidence
where source_conversation_id in (
  '21000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000003'
);
select lives_ok(
  $$update public.practice_sets set status = 'ready'
    where id = '51000000-0000-4000-8000-000000000003'$$,
  'a Change Drill retains both source snapshots and evaluates only the replacement rule'
);

insert into public.practice_sets (
  id, learner_id, source_conversation_id, source_revision, source_kind, title,
  kind, instruction_revision_id, instruction_revision, change_proposal_id, status
)
values (
  '51000000-0000-4000-8000-000000000004',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000004', 'new-r1', 'fixture',
  'Colliding Change Drill', 'changeDrill',
  '31000000-0000-4000-8000-000000000004', 'instructions-new-r1',
  '91000000-0000-4000-8000-000000000001', 'draft'
);
insert into public.practice_set_instructions (
  learner_id, practice_set_id, instruction_id, instruction_source_revision, position
)
values
  ('11000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000004', 'old-r1', 1),
  ('11000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000004', '41000000-0000-4000-8000-000000000005', 'new-r1', 2);
insert into public.scenarios (
  id, learner_id, practice_set_id, source_revision, kind, character_id,
  prompt, context, acceptable_signals, critical_misses, retry_prompt, ordering
)
values (
  '61000000-0000-4000-8000-000000000008',
  '11000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000004', 'new-r1', 'changeDrill',
  'guide-maya', 'Apply the colliding revision', 'This snapshot is unrelated.',
  '["seven days"]', '["five days"]', 'Use the replacement rule.', 1
);
insert into public.scenario_rules (
  learner_id, scenario_id, instruction_id, instruction_source_revision, position
)
values (
  '11000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000008',
  '41000000-0000-4000-8000-000000000005', 'new-r1', 1
);
insert into public.scenario_evidence (
  learner_id, scenario_id, source_conversation_id, source_revision, evidence_id, position
)
select
  '11000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000008',
  source_conversation_id, source_revision, id,
  row_number() over (order by source_revision)::smallint
from public.source_evidence
where source_conversation_id in (
  '21000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000003'
);
select throws_ok(
  $test$do $block$
  begin
    update public.practice_sets
    set status = 'ready'
    where id = '51000000-0000-4000-8000-000000000004';
    raise exception using errcode = 'P0001', message = 'colliding Change Drill snapshot unexpectedly passed';
  end
  $block$$test$,
  '23514',
  'change drill snapshot must match the replacement instruction',
  'a Change Drill cannot substitute a colliding opaque revision from another source'
);
select throws_ok(
  $$update public.instruction_revisions
    set created_at = created_at + interval '1 second'
    where id = '31000000-0000-4000-8000-000000000002'$$,
  '23514',
  'instruction revisions are immutable extraction snapshots',
  'instruction revision snapshots cannot be edited'
);
select throws_ok(
  $$update public.source_evidence
    set quote = 'Tampered evidence'
    where source_conversation_id = '21000000-0000-4000-8000-000000000002'$$,
  '23514',
  'evidence attached to a reviewed instruction is immutable',
  'reviewed instruction evidence content cannot be edited'
);

select * from finish();
rollback;
