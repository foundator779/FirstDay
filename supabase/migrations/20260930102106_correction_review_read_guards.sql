-- Consent applies to authenticated content projections as well as the API.
-- These restrictive policies AND with the existing owner policies. The read
-- graph is acyclic: source -> evidence/instruction -> change/practice -> scenario
-- -> attempt. Owner-only link tables contain identifiers, never source text.
create policy source_evidence_active_source_read on public.source_evidence as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.source_conversations s where s.learner_id=source_evidence.learner_id and s.id=source_evidence.source_conversation_id and s.source_revision=source_evidence.source_revision and s.consent_status='confirmed')
);
create policy instructions_active_sources_read on public.instructions as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.source_conversations s where s.learner_id=instructions.learner_id and s.id=instructions.source_conversation_id and s.source_revision=instructions.source_revision and s.consent_status='confirmed')
  and not exists(select 1 from public.instruction_evidence l left join public.source_evidence e on e.learner_id=l.learner_id and e.id=l.evidence_id where l.learner_id=instructions.learner_id and l.instruction_id=instructions.id and e.id is null)
);
create policy change_proposals_active_sources_read on public.change_proposals as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.instructions i where i.learner_id=change_proposals.learner_id and i.id=change_proposals.previous_instruction_id and i.source_revision=change_proposals.previous_source_revision)
  and exists(select 1 from public.instructions i where i.learner_id=change_proposals.learner_id and i.id=change_proposals.replacement_instruction_id and i.source_revision=change_proposals.source_revision)
);
create policy practice_sets_active_sources_read on public.practice_sets as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.source_conversations s where s.learner_id=practice_sets.learner_id and s.id=practice_sets.source_conversation_id and s.source_revision=practice_sets.source_revision and s.consent_status='confirmed')
  and not exists(select 1 from public.practice_set_instructions l left join public.instructions i on i.learner_id=l.learner_id and i.id=l.instruction_id and i.source_revision=l.instruction_source_revision where l.learner_id=practice_sets.learner_id and l.practice_set_id=practice_sets.id and i.id is null)
  and (change_proposal_id is null or exists(select 1 from public.change_proposals c where c.learner_id=practice_sets.learner_id and c.id=practice_sets.change_proposal_id))
);
create policy scenarios_active_sources_read on public.scenarios as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.practice_sets p where p.learner_id=scenarios.learner_id and p.id=scenarios.practice_set_id)
  and not exists(select 1 from public.scenario_evidence l left join public.source_evidence e on e.learner_id=l.learner_id and e.id=l.evidence_id where l.learner_id=scenarios.learner_id and l.scenario_id=scenarios.id and e.id is null)
);
create policy attempts_active_sources_read on public.attempts as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.scenarios s where s.learner_id=attempts.learner_id and s.id=attempts.scenario_id)
);
create policy attempt_rule_results_active_sources_read on public.attempt_rule_results as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.attempts a where a.learner_id=attempt_rule_results.learner_id and a.id=attempt_rule_results.attempt_id)
);
create policy open_questions_active_sources_read on public.open_questions as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.source_conversations s where s.learner_id=open_questions.learner_id and s.id=open_questions.source_conversation_id and s.source_revision=open_questions.source_revision and s.consent_status='confirmed')
  and not exists(select 1 from public.open_question_evidence l left join public.source_evidence e on e.learner_id=l.learner_id and e.id=l.evidence_id where l.learner_id=open_questions.learner_id and l.open_question_id=open_questions.id and e.id is null)
);
create policy understanding_checks_active_sources_read on public.understanding_checks as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.instructions i where i.learner_id=understanding_checks.learner_id and i.id=understanding_checks.instruction_id and i.source_conversation_id=understanding_checks.source_conversation_id and i.source_revision=understanding_checks.source_revision)
);
create policy source_corrections_active_sources_read on public.source_corrections as restrictive for select to authenticated using (
  learner_id=(select auth.uid()) and exists(select 1 from public.instructions i where i.learner_id=source_corrections.learner_id and i.id=source_corrections.instruction_id and i.source_conversation_id=source_corrections.source_conversation_id and i.source_revision=source_corrections.source_revision)
  and (payload->'request'->'after'->>'type'<>'newRule' or exists(select 1 from public.change_proposals c where c.learner_id=source_corrections.learner_id and c.id::text=source_corrections.payload->'request'->'after'->>'changeId' and c.previous_instruction_id=source_corrections.instruction_id and c.replacement_snapshot->>'sourceConversationId'=source_corrections.payload->'request'->'after'->>'laterSourceConversationId' and c.source_revision=source_corrections.payload->'request'->'after'->>'laterSourceRevision'))
);
notify pgrst,'reload schema';
