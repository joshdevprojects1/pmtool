-- On-demand polling: the API stamps poll_requested_at; the worker watches
-- for it between scheduled ticks and polls immediately, then clears it.
alter table org_connection add column poll_requested_at timestamptz;
