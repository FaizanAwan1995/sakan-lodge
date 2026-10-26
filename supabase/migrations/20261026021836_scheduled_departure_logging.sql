begin;
create extension if not exists pg_cron;
-- Compute Adelaide's date in the function, so this also works across DST.
select cron.schedule('sakan-scheduled-departure-history','*/15 * * * *','select sakan_private.record_elapsed_checkouts();');
commit;
