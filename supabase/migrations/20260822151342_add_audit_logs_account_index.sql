-- Account Context Menu (Phase 4): "Account History" reads audit_logs filtered
-- by table_name='accounts' + record_id — index that lookup directly.
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_table
  ON audit_logs (table_name, record_id, tenant_id)
  WHERE table_name = 'accounts';
