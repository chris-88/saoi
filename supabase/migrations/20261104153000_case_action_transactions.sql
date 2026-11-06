-- Two multi-write case actions as single transactions, for saoi-api (services/api).
--
-- supabase-js cannot hold a transaction across calls, so the writes that must stand or fall
-- together live in a function, which Postgres runs atomically. saoi-api calls them with the
-- service role (`rpc`); nothing else may: execute is revoked from everyone but service_role.
--
--   submit_application_tx  the ticked confirmations, the state change and its events
--   invite_partner_tx      the partner participant, the voided old links, the new link, the event
--
-- The Edge Function `case-action` does these as sequential writes and is unchanged.

create or replace function public.submit_application_tx(
  p_case_id uuid,
  p_application_id uuid,
  p_participant_id uuid,
  p_confirmations text[],
  p_from_state text,
  p_to_state text,
  p_events jsonb
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requirement text;
  v_event jsonb;
begin
  -- Compare-and-set on the state the caller read, so two taps cannot both submit.
  update applications
     set state = p_to_state, submitted_at = now()
   where id = p_application_id and case_id = p_case_id and state = p_from_state;
  if not found then
    return false;
  end if;

  foreach v_requirement in array coalesce(p_confirmations, '{}') loop
    insert into application_confirmations (application_id, requirement_id, participant_id, kind)
    values (p_application_id, v_requirement, p_participant_id, 'confirmation')
    on conflict (application_id, requirement_id) do update
      set participant_id = excluded.participant_id, kind = excluded.kind;
  end loop;

  for v_event in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    insert into events (case_id, application_id, type, actor, payload)
    values (
      p_case_id,
      p_application_id,
      v_event ->> 'type',
      coalesce(v_event ->> 'actor', 'customer'),
      coalesce(v_event -> 'payload', '{}'::jsonb)
    );
  end loop;

  return true;
end;
$$;

create or replace function public.invite_partner_tx(
  p_case_id uuid,
  p_name text,
  p_token_hash text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_partner uuid;
begin
  select id into v_partner
    from participants
   where case_id = p_case_id and role = 'partner'
   order by created_at
   limit 1;

  if v_partner is null then
    insert into participants (case_id, role, display_name)
    values (p_case_id, 'partner', p_name)
    returning id into v_partner;
  else
    update participants set display_name = p_name where id = v_partner;
  end if;

  -- Inviting again voids every earlier link for this case.
  update tokens
     set consumed_at = now()
   where case_id = p_case_id and kind = 'partner_invite' and consumed_at is null;

  -- Neither expires nor is used up: `expires_at` stays null.
  insert into tokens (case_id, kind, token_hash, participant_id, expires_at)
  values (p_case_id, 'partner_invite', p_token_hash, v_partner, null);

  insert into events (case_id, type, actor, payload)
  values (p_case_id, 'partner_invited', 'customer', jsonb_build_object('partnerName', p_name));

  return v_partner;
end;
$$;

revoke all on function public.submit_application_tx(uuid, uuid, uuid, text[], text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.invite_partner_tx(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_application_tx(uuid, uuid, uuid, text[], text, text, jsonb)
  to service_role;
grant execute on function public.invite_partner_tx(uuid, text, text) to service_role;
