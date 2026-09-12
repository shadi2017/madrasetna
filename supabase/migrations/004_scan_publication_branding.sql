-- Publication switches save immediately without overwriting the score formula.
create function public.set_publication(p_field text,p_value boolean,p_version integer) returns public.grading language plpgsql security definer set search_path='' as $$
declare r public.grading;begin perform public.require_admin();
 if p_field not in ('competition_published','project_published','results_published') or p_value is null then raise exception 'INVALID_CONFIG';end if;
 update public.grading set competition_published=case when p_field='competition_published' then p_value else competition_published end,project_published=case when p_field='project_published' then p_value else project_published end,results_published=case when p_field='results_published' then p_value else results_published end where id=1 and version=p_version returning * into r;
 if not found then raise exception 'CONFLICT_REFRESH';end if;return r;end $$;
create function public.save_grading_config(p_config jsonb,p_version integer) returns public.grading language plpgsql security definer set search_path='' as $$
declare r public.grading;begin perform public.require_admin();
 if exists(select 1 from jsonb_each(p_config->'daily_max') s where s.key<>'quiz' and s.value<>'10'::jsonb) then raise exception 'BINARY_DAILY';end if;
 update public.grading set config=p_config where id=1 and version=p_version returning * into r;if not found then raise exception 'CONFLICT_REFRESH';end if;return r;end $$;
-- Preserve old grades until edited; all newly entered daily scores except quiz are 0 or 10.
create function public.validate_binary_daily() returns trigger language plpgsql security definer set search_path='' as $$
declare k text;v jsonb;begin
 for k,v in select * from jsonb_each(new.scores) loop
  if k in ('discipline','bible','devotion','memory','phone','hymns','games') and v not in ('0'::jsonb,'10'::jsonb) and (TG_OP='INSERT' or old.scores->k is distinct from v) then raise exception 'BINARY_DAILY';end if;
 end loop;return new;end $$;
create trigger evaluations_binary before insert or update on public.evaluations for each row execute function public.validate_binary_daily();
alter table public.settings add column login_tagline text not null default 'كل طالب له مكان' check(length(login_tagline)<=250),add column login_title text not null default E'أيام بنعيشها.\nوخطوات بنكبرها.' check(length(login_title)<=500);
create function public.save_settings_v2(p_name text,p_slogan text,p_verse text,p_logo text,p_login_tagline text,p_login_title text,p_version integer) returns public.settings language plpgsql security definer set search_path='' as $$
declare r public.settings;begin perform public.require_admin();update public.settings set name=trim(p_name),slogan=p_slogan,verse=p_verse,logo=p_logo,login_tagline=p_login_tagline,login_title=p_login_title where id=1 and version=p_version returning * into r;if not found then raise exception 'CONFLICT_REFRESH';end if;return r;end $$;
revoke execute on function public.set_publication(text,boolean,integer),public.save_grading_config(jsonb,integer),public.validate_binary_daily(),public.save_settings_v2(text,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.set_publication(text,boolean,integer),public.save_grading_config(jsonb,integer),public.save_settings_v2(text,text,text,text,text,text,integer) to authenticated;

create or replace function public.restore_revision(p_audit uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.audit_log;n integer;
begin perform public.require_admin();select * into a from public.audit_log where id=p_audit;
 if not found or a.before_data is null then raise exception 'NO_PREVIOUS_VERSION';end if;
 if a.entity='profiles' then update public.profiles set status=coalesce(a.before_data->>'status',status),full_name=a.before_data->>'full_name',phone=a.before_data->>'phone',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='days' then update public.days set discipline_deadline=(a.before_data->>'discipline_deadline')::time,label=a.before_data->>'label',date=(a.before_data->>'date')::date,deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='evaluations' then update public.evaluations set scores=a.before_data->'scores',present=(a.before_data->>'present')::boolean,attended_at=(a.before_data->>'attended_at')::timestamptz,notes=a.before_data->>'notes',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='final_scores' then update public.final_scores set part_scores=a.before_data->'part_scores',competition=(a.before_data->>'competition')::numeric,project=(a.before_data->>'project')::numeric,notes=a.before_data->>'notes',deleted_at=(a.before_data->>'deleted_at')::timestamptz where id=a.record_id::uuid and version=p_version;
 elsif a.entity='grading' then update public.grading set competition_published=coalesce((a.before_data->>'competition_published')::boolean,false),project_published=coalesce((a.before_data->>'project_published')::boolean,false),config=a.before_data->'config',results_published=(a.before_data->>'results_published')::boolean where id=1 and version=p_version;
 elsif a.entity='settings' then update public.settings set login_title=coalesce(a.before_data->>'login_title',login_title),login_tagline=coalesce(a.before_data->>'login_tagline',login_tagline),name=a.before_data->>'name',slogan=a.before_data->>'slogan',verse=a.before_data->>'verse',logo=a.before_data->>'logo' where id=1 and version=p_version;
 else raise exception 'INVALID_ENTITY';end if;
 get diagnostics n=row_count;if n<>1 then raise exception 'CONFLICT_REFRESH';end if;
end $$;
