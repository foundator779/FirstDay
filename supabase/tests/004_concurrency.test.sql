begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

select plan(4);

select extensions.dblink_connect(
  'writer',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'revoker',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_exec(
  'writer',
  $$delete from auth.users where id = '13000000-0000-4000-8000-000000000001'$$
);
select extensions.dblink_exec(
  'writer',
  $$insert into auth.users (id, email)
    values ('13000000-0000-4000-8000-000000000001', 'concurrency@example.test')$$
);
select extensions.dblink_exec(
  'writer',
  $$insert into public.source_conversations (
      id, learner_id, bee_source_id, source_kind, title, started_at,
      transcript_hash, source_revision, consent_status, consent_confirmed_at, status
    ) values (
      '23000000-0000-4000-8000-000000000001',
      '13000000-0000-4000-8000-000000000001',
      'fixture-concurrency', 'fixture', 'Concurrent import', '2026-01-01T20:00:00Z',
      encode(extensions.digest(convert_to('Concurrent transcript', 'UTF8'), 'sha256'), 'hex'),
      'concurrency-r1', 'confirmed', '2026-01-01T20:01:00Z', 'ready'
    )$$
);

select extensions.dblink_exec('writer', 'begin');
select extensions.dblink_exec('writer', 'set local role service_role');
select extensions.dblink_exec(
  'writer',
  $$insert into private.source_materials (
      id, learner_id, source_conversation_id, source_revision, transcript, utterances
    ) values (
      '33000000-0000-4000-8000-000000000001',
      '13000000-0000-4000-8000-000000000001',
      '23000000-0000-4000-8000-000000000001',
      'concurrency-r1', 'Concurrent transcript', '[{"id":"utt-concurrency"}]'
    )$$
);

select extensions.dblink_exec('revoker', 'set role service_role');
select is(
  extensions.dblink_send_query(
    'revoker',
    $$select private.revoke_source_consent(
        '13000000-0000-4000-8000-000000000001',
        '23000000-0000-4000-8000-000000000001',
        'concurrency-r1',
        'Concurrent revocation'
      )$$
  ),
  1,
  'a second database session starts consent revocation'
);

do $$
begin
  perform pg_catalog.pg_sleep(0.25);
end;
$$;

select is(
  extensions.dblink_is_busy('revoker'),
  1,
  'consent revocation waits for an in-flight source-bound writer'
);

select extensions.dblink_exec('writer', 'commit');

select *
from extensions.dblink_get_result('revoker') as result(stale_ids uuid[]);

select is(
  (
    select consent_status
    from public.source_conversations
    where learner_id = '13000000-0000-4000-8000-000000000001'
      and id = '23000000-0000-4000-8000-000000000001'
  ),
  'revoked',
  'the waiting consent revocation commits after the writer finishes'
);
select is(
  (
    select count(*)::integer
    from private.source_materials
    where learner_id = '13000000-0000-4000-8000-000000000001'
      and source_conversation_id = '23000000-0000-4000-8000-000000000001'
  ),
  0,
  'the revocation cleans up material committed by the concurrent writer'
);

select extensions.dblink_exec(
  'writer',
  $$delete from auth.users where id = '13000000-0000-4000-8000-000000000001'$$
);
select extensions.dblink_disconnect('revoker');
select extensions.dblink_disconnect('writer');

select * from finish();
rollback;
