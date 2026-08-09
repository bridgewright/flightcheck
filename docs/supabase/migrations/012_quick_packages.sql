-- F-84: additive package fields for the five-minute quick interview.
alter table packages add column if not exists kind text not null default 'standard';
alter table packages add column if not exists quick_company text;
alter table packages add column if not exists quick_role text;
