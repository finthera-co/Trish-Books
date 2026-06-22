-- Stream notifications to the client in real time.
--
-- The invoice-due-reminders cron (and any other server-side inserts) drop rows
-- into public.notifications. Adding the table to the supabase_realtime
-- publication lets the NotificationBell subscribe to INSERTs and refresh the
-- moment a reminder is created, instead of waiting for the 30s poll.
--
-- Realtime still enforces RLS: a client only receives rows its SELECT policy
-- ("Users can view own notifications") permits, so tenant isolation holds.
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Emit full row data on changes so client-side filtering by tenant_id works.
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
