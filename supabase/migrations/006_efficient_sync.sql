create function public.sync_manifest(p_audit boolean default false) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;isadmin boolean:=public.is_admin();
begin
 select jsonb_build_object('admin',isadmin,'owner',public.is_owner(),
 'profiles',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.profiles),
 'days',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.days),
 'evaluations',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.evaluations),
 'settings',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.settings),
 'grading',(select jsonb_build_object('stamp',max(updated_at),'count',count(*)) from public.grading),
 'final_scores',(select jsonb_build_object('stamp',max((f->>'updated_at')::timestamptz),'count',count(*)) from public.get_final_scores() f),
 'revision',(select revision from public.results_signal where id=1)) into result;
 if p_audit and isadmin then result=result||jsonb_build_object('audit',(select jsonb_build_object('stamp',max(created_at),'count',count(*)) from public.audit_log));end if;
 return result;
end $$;
revoke execute on function public.sync_manifest(boolean) from public,anon;
grant execute on function public.sync_manifest(boolean) to authenticated;
