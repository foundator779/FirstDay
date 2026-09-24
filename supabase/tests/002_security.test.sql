begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'learner-one@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'learner-two@example.test');

insert into public.source_conversations (
  id, learner_id, bee_source_id, source_kind, title, started_at,
  transcript_hash, source_revision, consent_status, consent_confirmed_at,
  status
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'fixture-security-one', 'fixture', 'Learner one source', now(),
    repeat('a', 64), 'security-r1', 'confirmed', now(), 'ready'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'fixture-security-two', 'fixture', 'Learner two source', now(),
    repeat('b', 64), 'security-r1', 'confirmed', now(), 'ready'
  );

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = any(array[
        'source_conversations', 'instruction_revisions', 'source_evidence',
        'instructions', 'instruction_evidence', 'change_proposals',
        'practice_sets', 'practice_set_instructions', 'scenarios',
        'scenario_rules', 'scenario_evidence', 'attempts',
        'attempt_rule_results', 'open_questions', 'open_question_evidence'
      ])
      and grantee = 'authenticated'
      and privilege_type <> 'SELECT'
  ),
  0,
  'authenticated receives no public-table mutation privileges'
);
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = any(array[
        'source_conversations', 'instruction_revisions', 'source_evidence',
        'instructions', 'instruction_evidence', 'change_proposals',
        'practice_sets', 'practice_set_instructions', 'scenarios',
        'scenario_rules', 'scenario_evidence', 'attempts',
        'attempt_rule_results', 'open_questions', 'open_question_evidence'
      ])
      and grantee = 'authenticated'
      and privilege_type = 'SELECT'
  ),
  15,
  'authenticated receives SELECT on every FirstDay public table'
);
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema in ('public', 'private')
      and table_name = any(array[
        'source_conversations', 'instruction_revisions', 'source_evidence',
        'instructions', 'instruction_evidence', 'change_proposals',
        'practice_sets', 'practice_set_instructions', 'scenarios',
        'scenario_rules', 'scenario_evidence', 'attempts',
        'attempt_rule_results', 'open_questions', 'open_question_evidence',
        'source_materials', 'extraction_inputs', 'consent_events'
      ])
      and grantee = 'anon'
  ),
  0,
  'anon receives no FirstDay table privileges'
);
select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name = any(array['source_materials', 'extraction_inputs', 'consent_events'])
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  ),
  0,
  'client roles receive no private-table privileges'
);
select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
    and not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'client roles cannot use the private schema'
);
select ok(
  (
    select bool_and(has_table_privilege('service_role', format('%I.%I', table_schema, table_name), 'SELECT'))
    from information_schema.tables
    where table_schema in ('public', 'private')
      and table_name = any(array[
        'source_conversations', 'instruction_revisions', 'source_evidence',
        'instructions', 'instruction_evidence', 'change_proposals',
        'practice_sets', 'practice_set_instructions', 'scenarios',
        'scenario_rules', 'scenario_evidence', 'attempts',
        'attempt_rule_results', 'open_questions', 'open_question_evidence',
        'source_materials', 'extraction_inputs', 'consent_events'
      ])
  ),
  'service_role can read every persistence table'
);
select ok(
  has_table_privilege('service_role', 'private.source_materials', 'SELECT')
    and has_table_privilege('service_role', 'private.source_materials', 'INSERT')
    and not has_table_privilege('service_role', 'private.source_materials', 'UPDATE')
    and not has_table_privilege('service_role', 'private.source_materials', 'DELETE')
    and has_table_privilege('service_role', 'private.extraction_inputs', 'SELECT')
    and has_table_privilege('service_role', 'private.extraction_inputs', 'INSERT')
    and not has_table_privilege('service_role', 'private.extraction_inputs', 'UPDATE')
    and not has_table_privilege('service_role', 'private.extraction_inputs', 'DELETE'),
  'service_role can create but cannot mutate or delete immutable raw snapshots directly'
);
select is(
  (
    select count(*)::integer
    from pg_policy
    where polrelid in (
      select c.oid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any(array[
          'source_conversations', 'instruction_revisions', 'source_evidence',
          'instructions', 'instruction_evidence', 'change_proposals',
          'practice_sets', 'practice_set_instructions', 'scenarios',
          'scenario_rules', 'scenario_evidence', 'attempts',
          'attempt_rule_results', 'open_questions', 'open_question_evidence'
        ])
    )
      and polcmd = 'r'
      and polroles = array['authenticated'::regrole::oid]
  ),
  15,
  'each public table has one authenticated SELECT policy'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.source_conversations),
  1,
  'authenticated learner can read their own row'
);
select is(
  (
    select count(*)::integer
    from public.source_conversations
    where learner_id = '10000000-0000-4000-8000-000000000002'
  ),
  0,
  'authenticated learner cannot read another learner row'
);
select throws_ok(
  $$insert into public.source_conversations (
      learner_id, bee_source_id, source_kind, title, started_at,
      transcript_hash, source_revision, consent_status, consent_confirmed_at, status
    ) values (
      '10000000-0000-4000-8000-000000000001', 'denied', 'fixture', 'Denied', now(),
      repeat('c', 64), 'denied-r1', 'confirmed', now(), 'ready'
    )$$,
  '42501',
  'permission denied for table source_conversations',
  'authenticated learner cannot insert'
);
select throws_ok(
  $$update public.source_conversations set title = 'Denied update'$$,
  '42501',
  'permission denied for table source_conversations',
  'authenticated learner cannot update'
);
select throws_ok(
  $$delete from public.source_conversations$$,
  '42501',
  'permission denied for table source_conversations',
  'authenticated learner cannot delete'
);
select throws_ok(
  $$select * from private.source_materials$$,
  '42501',
  'permission denied for schema private',
  'authenticated learner cannot read private material'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.source_conversations$$,
  '42501',
  'permission denied for table source_conversations',
  'anon cannot read public learner data'
);

reset role;
set local role service_role;

select lives_ok(
  $$insert into public.instruction_revisions (
      id, learner_id, source_conversation_id, source_revision, revision
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'security-r1', 'security-instructions-r1'
    )$$,
  'service_role can create a processable instruction snapshot'
);
select lives_ok(
  $$insert into public.source_evidence (
      id, learner_id, source_conversation_id, source_revision,
      start_ms, end_ms, quote, utterance_ids
    )
    select
      'evd_' || encode(extensions.digest(convert_to(
        '20000000-0000-4000-8000-000000000001' || E'\nsecurity-r1\n10\n20',
        'UTF8'
      ), 'sha256'), 'hex'),
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'security-r1', 10, 20, 'Security evidence', '["utt-security"]'::jsonb$$,
  'service_role can satisfy source-evidence CHECK helpers'
);
select lives_ok(
  $$insert into public.instructions (
      id, learner_id, source_conversation_id, source_revision,
      instruction_revision_id, text, situation, expected_action,
      exceptions, confidence, status
    ) values (
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', 'security-r1',
      '30000000-0000-4000-8000-000000000001',
      'Security rule', 'Security situation', 'Security action',
      '[]', 0.9, 'needsReview'
    )$$,
  'service_role can satisfy instruction CHECK helpers'
);
select lives_ok(
  $$insert into public.practice_sets (
      id, learner_id, source_conversation_id, source_revision, source_kind,
      title, kind, instruction_revision_id, instruction_revision, status
    ) values (
      '50000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', 'security-r1', 'fixture',
      'Security practice', 'standard',
      '30000000-0000-4000-8000-000000000001',
      'security-instructions-r1', 'draft'
    )$$,
  'service_role can create processable draft practice'
);
select lives_ok(
  $$insert into public.scenarios (
      id, learner_id, practice_set_id, source_revision, kind, character_id,
      prompt, context, acceptable_signals, critical_misses, retry_prompt, ordering
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001', 'security-r1', 'standard',
      'customer-rowan', 'Security prompt', 'Security context',
      '["security signal"]', '[]', 'Security retry', 1
    )$$,
  'service_role can satisfy scenario CHECK helpers'
);

reset role;
select ok(
  (
    select count(*) = 7
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  )
    and has_function_privilege('service_role', 'private.is_text_array(jsonb,integer,integer,integer,boolean)', 'EXECUTE')
    and has_function_privilege('service_role', 'private.lock_source_processable(uuid,uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'private.lock_draft_practice(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'private.practice_progress(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'private.assert_practice_set_ready(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'private.confirm_change(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'private.revoke_source_consent(uuid,uuid,text,text)', 'EXECUTE'),
  'service_role receives exactly the required private helpers and controlled functions'
);
select ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and (
        has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        or has_function_privilege('anon', procedure.oid, 'EXECUTE')
      )
  ),
  'client roles cannot execute any private function'
);

select * from finish();
rollback;
