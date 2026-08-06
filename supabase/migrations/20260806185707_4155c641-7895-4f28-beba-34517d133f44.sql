insert into public.user_roles(user_id, role) values ('0b89ce71-ef78-4581-905f-7cd0576b7e2f','petwalker') on conflict do nothing;
insert into public.petwalker_profiles(user_id, approval_status, profile_completed)
values ('0b89ce71-ef78-4581-905f-7cd0576b7e2f','approved', true)
on conflict (user_id) do update set approval_status='approved', profile_completed=true;