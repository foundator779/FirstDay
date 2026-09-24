begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

select has_schema('private', 'private schema exists');

select has_table('public', table_name, format('public.%s exists', table_name))
from unnest(array[
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
]) as tables(table_name);

select has_table('private', table_name, format('private.%s exists', table_name))
from unnest(array[
  'source_materials',
  'extraction_inputs',
  'consent_events'
]) as tables(table_name);

select ok(
  to_regprocedure('private.revoke_source_consent(uuid,uuid,text,text)') is not null,
  'controlled consent-revocation function exists'
);
select ok(
  to_regprocedure('private.confirm_change(uuid,uuid)') is not null,
  'controlled change-confirmation function exists'
);
select is(
  encode(extensions.digest(convert_to('firstday', 'UTF8'), 'sha256'), 'hex'),
  'bad604f292b27b02c5adb1d8dfb8e31114b2045d1217e947734350a51c79da38',
  'pgcrypto digest resolves from the extensions schema'
);
select ok(
  (
    select bool_and(c.relrowsecurity)
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
  ),
  'RLS is enabled on every FirstDay public table'
);
select ok(
  (
    select bool_and(c.relforcerowsecurity)
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
  ),
  'RLS is forced on every FirstDay public table'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = any(array[
        'source_conversations', 'instruction_revisions', 'source_evidence',
        'instructions', 'instruction_evidence', 'change_proposals',
        'practice_sets', 'practice_set_instructions', 'scenarios',
        'scenario_rules', 'scenario_evidence', 'attempts',
        'attempt_rule_results', 'open_questions', 'open_question_evidence'
      ])
      and column_name = 'learner_id'
  ),
  15,
  'every FirstDay public table carries learner_id'
);
select is(
  (
    select count(*)::integer
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname in ('public', 'private')
      and t.relname = any(array[
        'source_conversations', 'instruction_revisions', 'source_evidence',
        'instructions', 'instruction_evidence', 'change_proposals',
        'practice_sets', 'practice_set_instructions', 'scenarios',
        'scenario_rules', 'scenario_evidence', 'attempts',
        'attempt_rule_results', 'open_questions', 'open_question_evidence',
        'source_materials', 'extraction_inputs', 'consent_events'
      ])
      and c.contype = 'p'
  ),
  18,
  'every FirstDay table has a primary key'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.source_conversations'::regclass
      and conname = 'source_conversations_source_identity_key'
      and contype = 'u'
  ),
  'source identity has an explicit unique constraint'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.source_evidence'::regclass
      and conname = 'source_evidence_digest_check'
      and contype = 'c'
  ),
  'source evidence IDs have a digest check constraint'
);
select ok(
  not exists (
    select 1
    from pg_constraint fk
    join pg_class child on child.oid = fk.conrelid
    join pg_namespace child_ns on child_ns.oid = child.relnamespace
    join pg_class parent on parent.oid = fk.confrelid
    join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
    where fk.contype = 'f'
      and child_ns.nspname = 'public'
      and parent_ns.nspname = 'public'
      and not exists (
        select 1
        from unnest(fk.conkey, fk.confkey) as keys(child_attnum, parent_attnum)
        join pg_attribute child_attr
          on child_attr.attrelid = fk.conrelid
         and child_attr.attnum = keys.child_attnum
        join pg_attribute parent_attr
          on parent_attr.attrelid = fk.confrelid
         and parent_attr.attnum = keys.parent_attnum
        where child_attr.attname = 'learner_id'
          and parent_attr.attname = 'learner_id'
      )
  ),
  'every public-to-public foreign key includes learner_id on both sides'
);
select ok(
  not exists (
    select 1
    from pg_constraint fk
    where fk.contype = 'f'
      and fk.connamespace in ('public'::regnamespace, 'private'::regnamespace)
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = fk.conrelid
          and i.indisvalid
          and i.indkey::smallint[] @> fk.conkey
      )
  ),
  'every foreign key is covered by an index'
);

select * from finish();
rollback;
