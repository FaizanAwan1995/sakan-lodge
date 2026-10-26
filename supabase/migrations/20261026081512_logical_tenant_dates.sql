begin;
alter table public.people add constraint tenant_dates_plausible check (
 start_date between date '2000-01-01' and date '2100-12-31'
 and (end_date is null or end_date between date '2000-01-01' and date '2100-12-31')
 and (paid_up_to is null or paid_up_to between date '2000-01-01' and date '2100-12-31')
 and (rent_cycle_anchor is null or rent_cycle_anchor between date '2000-01-01' and date '2100-12-31')
);
alter table public.people add constraint tenant_dates_ordered check ((end_date is null or end_date>start_date) and (paid_up_to is null or paid_up_to>=start_date-1));
commit;
