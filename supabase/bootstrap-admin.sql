-- Replace the email with the confirmed Auth user you created in the Supabase dashboard.
do $$
declare target uuid;
begin
 select id into target from auth.users where lower(email)=lower('YOUR_ADMIN_EMAIL@example.com');
 if target is null then raise exception 'Create the admin in Authentication > Users, then set the correct email here.';end if;
 insert into public.admins(user_id) values(target) on conflict do nothing;
end $$;

