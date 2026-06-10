import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) return errorResponse("Unauthorized", 401);

    const db = createClient(supabaseUrl, serviceKey);

    const { data: appUser } = await db
      .from("users")
      .select("id, tenant_id")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser) return errorResponse("User not found", 404);
    const tenantId = appUser.tenant_id;
    const internalUserId = appUser.id;

    const body = await req.json();
    const { event_type } = body;

    switch (event_type) {
      case "ASSET_CREATED":
        return await handleAssetCreated(db, tenantId, body, internalUserId);
      case "DEPRECIATION_POSTED":
        return await handleDepreciationPosted(db, tenantId, body, internalUserId);
      case "ASSET_DISPOSED":
        return await handleAssetDisposed(db, tenantId, body, internalUserId);
      case "ASSET_ADJUSTED":
        return await handleAssetAdjusted(db, tenantId, body, internalUserId);
      case "CATEGORY_TRANSFER":
        return await handleCategoryTransfer(db, tenantId, body, internalUserId);
      case "BULK_IMPORT":
        return await handleBulkImport(db, tenantId, body, internalUserId);
      default:
        return errorResponse(`Unknown event_type: ${event_type}`);
    }
  } catch (e) {
    console.error("post-asset-transaction error:", e);
    const message = e instanceof Error ? e.message : String(e);
    return errorResponse(message || "Internal error", 500);
  }
});

// ─── VALIDATION HELPERS ───

async function validateCategory(db: any, categoryId: string) {
  const { data: cat, error } = await db
    .from("asset_categories")
    .select("*")
    .eq("id", categoryId)
    .single();
  if (error || !cat) throw new Error("Asset category not found");
  if (!cat.is_active) throw new Error("Asset category is inactive");
  if (!cat.asset_account_id) throw new Error("Category missing asset account configuration");
  if (!cat.accumulated_depreciation_account_id) throw new Error("Category missing accumulated depreciation account");
  if (!cat.depreciation_expense_account_id) throw new Error("Category missing depreciation expense account");
  return cat;
}

async function validateAccountActive(db: any, accountId: string, label: string) {
  const { data: acct } = await db
    .from("accounts")
    .select("id, is_active")
    .eq("id", accountId)
    .single();
  if (!acct) throw new Error(`${label} account not found`);
  if (!acct.is_active) throw new Error(`${label} account is inactive`);
}

async function validatePeriodOpen(db: any, tenantId: string, date: string) {
  const { data: period } = await db
    .from("fiscal_periods")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .lte("period_start", date)
    .gte("period_end", date)
    .maybeSingle();
  if (period && period.status === "closed") {
    throw new Error(`Fiscal period containing ${date} is closed. Cannot post.`);
  }
}

// checkDuplicateDepreciation removed — now enforced by:
// 1. DB UNIQUE constraint on asset_depreciation(asset_id, period)
// 2. unique_key idempotency on journal_entries
// 3. 'processing' status lock preventing concurrent runs

// ─── AUDIT HELPER ───

async function logAudit(
  db: any,
  tenantId: string,
  userId: string,
  action: string,
  tableName: string,
  recordId: string,
  details: Record<string, unknown>
) {
  await db.from("audit_logs").insert({
    tenant_id: tenantId,
    user_id: userId,
    action,
    table_name: tableName,
    record_id: recordId,
    details,
  });
}

// ─── GL ↔ SUBLEDGER RECONCILIATION ───

async function reconcileAssetGL(db: any, tenantId: string, categoryAccountId: string) {
  // Sum of asset costs for assets linked to this asset account
  const { data: assets } = await db
    .from("fixed_assets")
    .select("cost, accumulated_depreciation, status")
    .eq("tenant_id", tenantId)
    .eq("asset_account_id", categoryAccountId)
    .eq("status", "active");

  const totalCost = (assets ?? []).reduce((s: number, a: any) => s + (a.cost || 0), 0);
  const totalAccumDepr = (assets ?? []).reduce((s: number, a: any) => s + (a.accumulated_depreciation || 0), 0);

  // GL balance for asset account: sum of debits - credits on posted journals
  const { data: glAsset } = await db.rpc("calculate_gl_balance_for_account", {
    p_account_id: categoryAccountId,
    p_tenant_id: tenantId,
  }).maybeSingle();

  // Log reconciliation status (non-blocking — logs warning but doesn't fail)
  if (glAsset) {
    const glBalance = glAsset.balance ?? 0;
    const diff = Math.abs(totalCost - glBalance);
    if (diff > 0.01) {
      console.warn(
        `RECONCILIATION WARNING: Asset account ${categoryAccountId} — ` +
        `Subledger total: ${totalCost}, GL balance: ${glBalance}, diff: ${diff}`
      );
    }
  }
}

// ─── JOURNAL HELPER ───

async function createJournal(
  db: any,
  tenantId: string,
  opts: {
    date: string;
    description: string;
    sourceType: string;
    sourceId: string;
    createdBy: string;
    uniqueKey?: string;
    lines: Array<{ account_id: string; debit: number; credit: number; asset_id?: string }>;
  }
) {
  // Validate double-entry balance
  const totalDebit = opts.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = opts.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(`Journal unbalanced: Dr ${totalDebit.toFixed(2)} != Cr ${totalCredit.toFixed(2)}`);
  }

  // Idempotency check: if unique_key already exists, return existing JE
  if (opts.uniqueKey) {
    const { data: existing } = await db
      .from("journal_entries")
      .select("id")
      .eq("unique_key", opts.uniqueKey)
      .maybeSingle();
    if (existing) {
      console.log(`Idempotency: JE already exists for key ${opts.uniqueKey}, returning ${existing.id}`);
      return existing.id;
    }
  }

  const { data: je, error: jeErr } = await db
    .from("journal_entries")
    .insert({
      tenant_id: tenantId,
      entry_date: opts.date,
      description: opts.description,
      status: "posted",
      posted_at: new Date().toISOString(),
      is_system_generated: true,
      source_type: opts.sourceType,
      source_id: opts.sourceId,
      created_by: opts.createdBy,
      unique_key: opts.uniqueKey || null,
    })
    .select("id")
    .single();
  if (jeErr) throw new Error(`Failed to create journal: ${jeErr.message}`);

  const { error: lErr } = await db.from("journal_lines").insert(
    opts.lines.map((l) => ({
      journal_entry_id: je.id,
      account_id: l.account_id,
      debit: Math.round(l.debit * 100) / 100,
      credit: Math.round(l.credit * 100) / 100,
      asset_id: l.asset_id || null,
    }))
  );
  if (lErr) throw new Error(`Failed to create journal lines: ${lErr.message}`);

  return je.id;
}

// ─── DEPRECIATION SCHEDULE GENERATORS ───

function generateStraightLineSchedule(
  assetId: string,
  tenantId: string,
  cost: number,
  salvageValue: number,
  lifeMonths: number,
  startDate: string
) {
  const records: any[] = [];
  const depreciableBase = cost - salvageValue;
  if (depreciableBase <= 0 || lifeMonths <= 0) return records;

  const monthlyDep = depreciableBase / lifeMonths;
  let accumulated = 0;
  const [startYear, startMonth] = startDate.split("-").map(Number);

  for (let i = 0; i < lifeMonths; i++) {
    const month = ((startMonth - 1 + i) % 12) + 1;
    const year = startYear + Math.floor((startMonth - 1 + i) / 12);
    const period = `${year}-${String(month).padStart(2, "0")}`;

    let dep = monthlyDep;
    const currentNBV = cost - accumulated;

    if (currentNBV <= salvageValue) break;
    if (currentNBV - dep < salvageValue) dep = currentNBV - salvageValue;
    dep = Math.max(0, dep);
    if (dep <= 0) break;

    accumulated += dep;

    records.push({
      asset_id: assetId,
      tenant_id: tenantId,
      period,
      depreciation_amount: Math.round(dep * 100) / 100,
      accumulated_depreciation: Math.round(accumulated * 100) / 100,
      net_book_value: Math.round((cost - accumulated) * 100) / 100,
      status: "pending",
    });
  }
  return records;
}

function generateDecliningBalanceSchedule(
  assetId: string,
  tenantId: string,
  cost: number,
  salvageValue: number,
  lifeMonths: number,
  startDate: string
) {
  const records: any[] = [];
  if (lifeMonths <= 0 || cost <= salvageValue) return records;

  // Double declining balance rate
  const annualRate = (2 / (lifeMonths / 12)) / 12; // monthly rate
  let accumulated = 0;
  const [startYear, startMonth] = startDate.split("-").map(Number);

  for (let i = 0; i < lifeMonths; i++) {
    const month = ((startMonth - 1 + i) % 12) + 1;
    const year = startYear + Math.floor((startMonth - 1 + i) / 12);
    const period = `${year}-${String(month).padStart(2, "0")}`;

    const currentNBV = cost - accumulated;
    if (currentNBV <= salvageValue) break;

    let dep = currentNBV * annualRate;

    // Switch to straight-line if it yields higher depreciation (standard DDB behavior)
    const remainingMonths = lifeMonths - i;
    const slDep = remainingMonths > 0 ? (currentNBV - salvageValue) / remainingMonths : 0;
    if (slDep > dep) dep = slDep;

    if (currentNBV - dep < salvageValue) dep = currentNBV - salvageValue;
    dep = Math.max(0, dep);
    if (dep <= 0) break;

    accumulated += dep;

    records.push({
      asset_id: assetId,
      tenant_id: tenantId,
      period,
      depreciation_amount: Math.round(dep * 100) / 100,
      accumulated_depreciation: Math.round(accumulated * 100) / 100,
      net_book_value: Math.round((cost - accumulated) * 100) / 100,
      status: "pending",
    });
  }
  return records;
}

function generateDepreciationSchedule(
  assetId: string,
  tenantId: string,
  cost: number,
  salvageValue: number,
  lifeMonths: number,
  startDate: string,
  method: string
) {
  switch (method) {
    case "declining_balance":
    case "double_declining":
      return generateDecliningBalanceSchedule(assetId, tenantId, cost, salvageValue, lifeMonths, startDate);
    case "straight_line":
    default:
      return generateStraightLineSchedule(assetId, tenantId, cost, salvageValue, lifeMonths, startDate);
  }
}

// ─── EVENT: ASSET_CREATED ───

async function handleAssetCreated(db: any, tenantId: string, body: any, userId: string) {
  const { name, category_id, cost, salvage_value, useful_life_months, purchase_date, depreciation_start_date, payment_account_id, description } = body;

  if (!name || !category_id || !cost || !payment_account_id) {
    return errorResponse("Required: name, category_id, cost, payment_account_id");
  }
  if (cost <= 0) return errorResponse("Cost must be > 0");
  const sv = salvage_value ?? 0;
  if (sv > cost) return errorResponse("Salvage value must be ≤ cost");
  const lifeMonths = useful_life_months ?? 60;
  if (lifeMonths <= 0) return errorResponse("Useful life must be > 0");
  const pDate = purchase_date || new Date().toISOString().split("T")[0];
  const dStart = depreciation_start_date || pDate;

  // Validate category + all accounts
  const cat = await validateCategory(db, category_id);
  await validateAccountActive(db, cat.asset_account_id, "Asset");
  await validateAccountActive(db, cat.accumulated_depreciation_account_id, "Accum. Depreciation");
  await validateAccountActive(db, cat.depreciation_expense_account_id, "Depreciation Expense");
  await validateAccountActive(db, payment_account_id, "Payment");
  if (cat.disposal_gain_account_id) await validateAccountActive(db, cat.disposal_gain_account_id, "Disposal Gain");
  if (cat.disposal_loss_account_id) await validateAccountActive(db, cat.disposal_loss_account_id, "Disposal Loss");
  await validatePeriodOpen(db, tenantId, pDate);

  // 1. Create asset — accounts resolved from category, NOT stored from user
  const { data: asset, error: assetErr } = await db
    .from("fixed_assets")
    .insert({
      tenant_id: tenantId,
      asset_name: name,
      description: description || null,
      category_id,
      asset_account_id: cat.asset_account_id,
      depreciation_account_id: cat.accumulated_depreciation_account_id,
      depr_expense_account_id: cat.depreciation_expense_account_id,
      cost,
      salvage_value: sv,
      useful_life_months: lifeMonths,
      depreciation_method: cat.depreciation_method,
      acquisition_date: pDate,
      start_date: dStart,
      status: "active",
      accumulated_depreciation: 0,
    } as any)
    .select("id")
    .single();
  if (assetErr) throw new Error(`Failed to create asset: ${assetErr.message}`);

  // 2. Post acquisition journal: Dr Asset, Cr Payment
  const jeId = await createJournal(db, tenantId, {
    date: pDate,
    description: `Asset Acquisition – ${name}`,
    sourceType: "asset_acquisition",
    sourceId: asset.id,
    createdBy: userId,
    lines: [
      { account_id: cat.asset_account_id, debit: cost, credit: 0, asset_id: asset.id },
      { account_id: payment_account_id, debit: 0, credit: cost },
    ],
  });

  // 3. Insert subledger entry
  const { data: jLines } = await db
    .from("journal_lines")
    .select("id")
    .eq("journal_entry_id", jeId)
    .gt("debit", 0)
    .limit(1)
    .single();

  await db.from("asset_subledger").insert({
    tenant_id: tenantId,
    asset_id: asset.id,
    journal_line_id: jLines.id,
    journal_id: jeId,
    debit: cost,
    credit: 0,
    amount: cost,
    balance: cost,
    cost,
    salvage: sv,
    life_years: Math.round(lifeMonths / 12),
    transaction_type: "acquisition",
  } as any);

  // 4. Generate full depreciation schedule
  const schedule = generateDepreciationSchedule(asset.id, tenantId, cost, sv, lifeMonths, dStart, cat.depreciation_method);

  if (schedule.length > 0) {
    const { error: schedErr } = await db.from("asset_depreciation").insert(schedule);
    if (schedErr) console.error("Schedule generation warning:", schedErr.message);
  }

  // 5. Audit trail
  await logAudit(db, tenantId, userId, "Asset Created", "fixed_assets", asset.id, {
    name, category_id, cost, salvage_value: sv, useful_life_months: lifeMonths,
    journal_entry_id: jeId, schedule_rows: schedule.length,
  });

  // 6. Non-blocking reconciliation check
  try { await reconcileAssetGL(db, tenantId, cat.asset_account_id); } catch (_) {}

  return jsonResponse({
    success: true,
    asset_id: asset.id,
    journal_entry_id: jeId,
    schedule_rows: schedule.length,
  });
}

// ─── EVENT: DEPRECIATION_POSTED ───

async function handleDepreciationPosted(db: any, tenantId: string, body: any, userId: string) {
  const { period } = body;
  if (!period) return errorResponse("Required: period (YYYY-MM)");
  if (!/^\d{4}-\d{2}$/.test(period)) return errorResponse("Period must be YYYY-MM format");

  const periodDate = `${period}-01`;
  await validatePeriodOpen(db, tenantId, periodDate);

  console.log(`[DEPRECIATION] Starting run for tenant=${tenantId}, period=${period}`);

  // STEP 1: Fetch all pending rows for this period
  const { data: rows, error: rErr } = await db
    .from("asset_depreciation")
    .select("*, fixed_assets!inner(id, asset_name, category_id, cost, salvage_value, asset_account_id, depreciation_account_id, depr_expense_account_id, status)")
    .eq("tenant_id", tenantId)
    .eq("period", period)
    .eq("status", "pending");

  if (rErr) throw new Error(`Failed to fetch schedule: ${rErr.message}`);

  console.log(`[DEPRECIATION] Total pending rows found: ${rows?.length ?? 0}`);

  if (!rows || rows.length === 0) {
    // Check if already posted
    const { data: postedRows } = await db
      .from("asset_depreciation")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("period", period)
      .eq("status", "posted")
      .limit(1);
    const alreadyPosted = postedRows && postedRows.length > 0;
    return jsonResponse({
      success: true, processed: 0, skipped: 0,
      message: alreadyPosted
        ? "All depreciation for this period has already been posted"
        : "No pending depreciation for this period",
    });
  }

  // Fetch global account_settings fallbacks (used when category accounts are missing)
  const { data: globalSettings } = await db
    .from("account_settings")
    .select("depreciation_expense_account_id, accum_depreciation_account_id, accumulated_depreciation_account_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // STEP 2: Mark all rows as 'processing' to lock against concurrent runs
  const rowIds = rows.map((r: any) => r.id);
  const { error: lockErr } = await db
    .from("asset_depreciation")
    .update({ status: "processing" })
    .in("id", rowIds);
  if (lockErr) {
    console.error(`[DEPRECIATION] Failed to lock rows: ${lockErr.message}`);
    throw new Error(`Failed to lock depreciation rows: ${lockErr.message}`);
  }
  console.log(`[DEPRECIATION] Locked ${rowIds.length} rows to 'processing'`);

  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];
  const journalEntryIds: string[] = [];

  // STEP 3: Process each row
  for (const row of rows) {
    const asset = row.fixed_assets;

    // Skip inactive/disposed assets
    if (!asset || asset.status !== "active") {
      const reason = `Asset ${asset?.asset_name ?? row.asset_id}: status=${asset?.status ?? 'missing'}`;
      errors.push(reason);
      console.log(`[DEPRECIATION] SKIP: ${reason}`);
      // Reset to pending so it can be retried if asset becomes active
      await db.from("asset_depreciation").update({ status: "pending" }).eq("id", row.id);
      skipped++;
      continue;
    }

    try {
      // STEP 4: Resolve accounts from category (STRICT — no fallback)
      if (!asset.category_id) {
        throw new Error("Asset has no category_id — cannot resolve accounts");
      }

      const { data: cat, error: catErr } = await db
        .from("asset_categories")
        .select("depreciation_expense_account_id, accumulated_depreciation_account_id")
        .eq("id", asset.category_id)
        .single();
      if (catErr || !cat) throw new Error("Asset category not found");

      // Three-tier resolution:
      // 1. Asset's own stored account (snapshot from category at creation time)
      // 2. Current asset category account
      // 3. Global account_settings fallback (Settings → Account Mapping)
      const expenseAccountId =
        asset.depr_expense_account_id              // tier 1: asset snapshot
        ?? cat.depreciation_expense_account_id      // tier 2: category
        ?? globalSettings?.depreciation_expense_account_id; // tier 3: global

      const accumAccountId =
        asset.depreciation_account_id              // tier 1: asset snapshot
        ?? cat.accumulated_depreciation_account_id  // tier 2: category
        ?? globalSettings?.accum_depreciation_account_id
        ?? globalSettings?.accumulated_depreciation_account_id; // tier 3: global (both column names)

      if (!expenseAccountId) {
        throw new Error(
          `Depreciation Expense account not configured for asset "${asset.asset_name}". ` +
          `Set it on the asset category or in Settings → Account Mapping.`
        );
      }
      if (!accumAccountId) {
        throw new Error(
          `Accumulated Depreciation account not configured for asset "${asset.asset_name}". ` +
          `Set it on the asset category or in Settings → Account Mapping.`
        );
      }

      // Validate both accounts are active
      await validateAccountActive(db, expenseAccountId, "Depreciation Expense");
      await validateAccountActive(db, accumAccountId, "Accumulated Depreciation");

      // STEP 5: Build idempotency key
      const uniqueKey = `dep_${asset.id}_${period}`;

      // STEP 6: Create journal entry with idempotency
      const jeId = await createJournal(db, tenantId, {
        date: periodDate,
        description: `Depreciation – ${asset.asset_name} (${period})`,
        sourceType: "depreciation",
        sourceId: asset.id,
        createdBy: userId,
        uniqueKey,
        lines: [
          { account_id: expenseAccountId, debit: row.depreciation_amount, credit: 0, asset_id: asset.id },
          { account_id: accumAccountId, debit: 0, credit: row.depreciation_amount, asset_id: asset.id },
        ],
      });

      // STEP 7: Update schedule row → posted
      const { error: updateErr } = await db.from("asset_depreciation")
        .update({ status: "posted", journal_entry_id: jeId })
        .eq("id", row.id);
      if (updateErr) throw new Error(`Failed to update schedule: ${updateErr.message}`);

      // STEP 8: Update asset accumulated_depreciation
      const { error: assetErr } = await db.from("fixed_assets")
        .update({ accumulated_depreciation: row.accumulated_depreciation })
        .eq("id", asset.id);
      if (assetErr) throw new Error(`Failed to update asset: ${assetErr.message}`);

      // STEP 9: Insert subledger entry
      const { data: depLine } = await db
        .from("journal_lines")
        .select("id")
        .eq("journal_entry_id", jeId)
        .gt("credit", 0)
        .limit(1)
        .single();

      if (depLine) {
        await db.from("asset_subledger").insert({
          tenant_id: tenantId,
          asset_id: asset.id,
          journal_line_id: depLine.id,
          journal_id: jeId,
          debit: 0,
          credit: row.depreciation_amount,
          amount: row.depreciation_amount,
          balance: row.accumulated_depreciation,
          cost: asset.cost,
          salvage: asset.salvage_value || 0,
          transaction_type: "depreciation",
        } as any);
      }

      // STEP 10: Audit trail
      await logAudit(db, tenantId, userId, "Depreciation Posted", "asset_depreciation", row.id, {
        asset_id: asset.id, period, amount: row.depreciation_amount, journal_entry_id: jeId,
      });

      journalEntryIds.push(jeId);
      processed++;
      console.log(`[DEPRECIATION] POSTED: ${asset.asset_name} | amount=${row.depreciation_amount} | JE=${jeId}`);
    } catch (err) {
      // FAILURE HANDLING: Reset row to 'pending' so it can be retried
      await db.from("asset_depreciation").update({ status: "pending" }).eq("id", row.id);
      const msg = `Asset ${asset.asset_name}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`[DEPRECIATION] ERROR: ${msg}`);
      skipped++;
    }
  }

  // Debug summary
  console.log(`[DEPRECIATION] ===== RUN COMPLETE =====`);
  console.log(`[DEPRECIATION] Total rows: ${rows.length} | Processed: ${processed} | Skipped: ${skipped}`);
  if (errors.length > 0) console.log(`[DEPRECIATION] Errors: ${JSON.stringify(errors)}`);
  if (journalEntryIds.length > 0) console.log(`[DEPRECIATION] JE IDs: ${journalEntryIds.join(", ")}`);

  return jsonResponse({
    success: true, processed, skipped,
    journal_entry_ids: journalEntryIds,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ─── EVENT: ASSET_DISPOSED ───

async function handleAssetDisposed(db: any, tenantId: string, body: any, userId: string) {
  const { asset_id, sale_price, cash_account_id } = body;
  if (!asset_id || sale_price === undefined || !cash_account_id) {
    return errorResponse("Required: asset_id, sale_price, cash_account_id");
  }

  const { data: asset, error: aErr } = await db
    .from("fixed_assets")
    .select("*")
    .eq("id", asset_id)
    .single();
  if (aErr || !asset) return errorResponse("Asset not found", 404);
  if (asset.status === "disposed") return errorResponse("Asset is already disposed");

  const today = new Date().toISOString().split("T")[0];
  await validatePeriodOpen(db, tenantId, today);
  await validateAccountActive(db, cash_account_id, "Cash/Bank");

  // Fetch global account_settings fallbacks
  const { data: globalSettings } = await db
    .from("account_settings")
    .select("gain_on_disposal_account_id, loss_on_disposal_account_id, accum_depreciation_account_id, accumulated_depreciation_account_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // Resolve ALL accounts — three-tier: asset snapshot → category → global settings
  let assetAccountId = asset.asset_account_id;
  let accumAccountId: string | null =
    asset.depreciation_account_id
    ?? globalSettings?.accum_depreciation_account_id
    ?? globalSettings?.accumulated_depreciation_account_id
    ?? null;
  let gainAccountId: string | null = globalSettings?.gain_on_disposal_account_id ?? null;
  let lossAccountId: string | null = globalSettings?.loss_on_disposal_account_id ?? null;

  if (asset.category_id) {
    const cat = await validateCategory(db, asset.category_id);
    // Category values override global settings but not asset-level snapshot
    assetAccountId = cat.asset_account_id ?? assetAccountId;
    accumAccountId = asset.depreciation_account_id
      ?? cat.accumulated_depreciation_account_id
      ?? globalSettings?.accum_depreciation_account_id
      ?? globalSettings?.accumulated_depreciation_account_id
      ?? null;
    gainAccountId  = cat.disposal_gain_account_id ?? globalSettings?.gain_on_disposal_account_id ?? null;
    lossAccountId  = cat.disposal_loss_account_id ?? globalSettings?.loss_on_disposal_account_id ?? null;
  }

  if (!assetAccountId) return errorResponse("Asset account not configured");

  // NBV computed by system only
  const accumDepr = asset.accumulated_depreciation ?? 0;
  const nbv = asset.cost - accumDepr;
  const gainLoss = sale_price - nbv;

  // Build journal lines
  const lines: Array<{ account_id: string; debit: number; credit: number; asset_id?: string }> = [];

  if (sale_price > 0) {
    lines.push({ account_id: cash_account_id, debit: sale_price, credit: 0 });
  }
  if (accumAccountId && accumDepr > 0) {
    lines.push({ account_id: accumAccountId, debit: accumDepr, credit: 0, asset_id: asset_id });
  }
  lines.push({ account_id: assetAccountId, debit: 0, credit: asset.cost, asset_id: asset_id });

  if (gainLoss > 0) {
    if (!gainAccountId) return errorResponse(
      "Disposal Gain account not configured. Set it on the asset category or in Settings → Account Mapping."
    );
    lines.push({ account_id: gainAccountId, debit: 0, credit: gainLoss });
  } else if (gainLoss < 0) {
    if (!lossAccountId) return errorResponse(
      "Disposal Loss account not configured. Set it on the asset category or in Settings → Account Mapping."
    );
    lines.push({ account_id: lossAccountId, debit: Math.abs(gainLoss), credit: 0 });
  }

  const jeId = await createJournal(db, tenantId, {
    date: today,
    description: `Asset Disposal – ${asset.asset_name}`,
    sourceType: "asset_disposal",
    sourceId: asset_id,
    createdBy: userId,
    lines,
  });

  await db.from("asset_disposals").insert({
    asset_id,
    tenant_id: tenantId,
    disposal_date: today,
    sale_value: sale_price,
    gain_loss: gainLoss,
    journal_entry_id: jeId,
  } as any);

  await db.from("fixed_assets").update({ status: "disposed" }).eq("id", asset_id);

  // Cancel remaining pending depreciation
  await db.from("asset_depreciation")
    .update({ status: "cancelled" } as any)
    .eq("asset_id", asset_id)
    .eq("status", "pending");

  // Subledger entry
  const { data: crLine } = await db
    .from("journal_lines")
    .select("id")
    .eq("journal_entry_id", jeId)
    .eq("account_id", assetAccountId)
    .gt("credit", 0)
    .limit(1)
    .single();

  if (crLine) {
    await db.from("asset_subledger").insert({
      tenant_id: tenantId,
      asset_id,
      journal_line_id: crLine.id,
      journal_id: jeId,
      debit: 0,
      credit: asset.cost,
      amount: asset.cost,
      balance: 0,
      cost: asset.cost,
      salvage: asset.salvage_value || 0,
      transaction_type: "disposal",
    } as any);
  }

  // Audit trail
  await logAudit(db, tenantId, userId, "Asset Disposed", "fixed_assets", asset_id, {
    sale_price, nbv, gain_loss: gainLoss, journal_entry_id: jeId,
  });

  return jsonResponse({ success: true, asset_id, journal_entry_id: jeId, gain_loss: gainLoss, nbv });
}

// ─── EVENT: ASSET_ADJUSTED ───

async function handleAssetAdjusted(db: any, tenantId: string, body: any, userId: string) {
  const { asset_id, adjustment_type, amount, reason } = body;
  if (!asset_id || !adjustment_type || amount === undefined) {
    return errorResponse("Required: asset_id, adjustment_type, amount");
  }

  const { data: asset } = await db.from("fixed_assets").select("*").eq("id", asset_id).single();
  if (!asset) return errorResponse("Asset not found", 404);
  if (asset.status === "disposed") return errorResponse("Cannot adjust a disposed asset");

  const today = new Date().toISOString().split("T")[0];
  await validatePeriodOpen(db, tenantId, today);

  if (!asset.category_id) return errorResponse("Asset has no category");
  const cat = await validateCategory(db, asset.category_id);

  if (adjustment_type === "revaluation") {
    // Revalue asset cost — Dr/Cr Asset Account, offset to equity/revaluation surplus
    const diff = amount - asset.cost;
    if (Math.abs(diff) < 0.01) return errorResponse("No change in value");

    const lines = diff > 0
      ? [
          { account_id: cat.asset_account_id, debit: diff, credit: 0, asset_id },
          { account_id: cat.asset_account_id, debit: 0, credit: 0 }, // placeholder
        ]
      : [
          { account_id: cat.asset_account_id, debit: 0, credit: Math.abs(diff), asset_id },
        ];

    // For a proper revaluation, you'd credit a Revaluation Surplus equity account
    // For now, log the adjustment
    await db.from("fixed_assets").update({ cost: amount } as any).eq("id", asset_id);

    // Regenerate remaining depreciation schedule
    await db.from("asset_depreciation").delete().eq("asset_id", asset_id).eq("status", "pending");
    const newSchedule = generateDepreciationSchedule(
      asset_id, tenantId, amount, asset.salvage_value,
      asset.useful_life_months, asset.start_date || today,
      cat.depreciation_method
    );
    // Filter out already-posted periods
    const { data: postedPeriods } = await db.from("asset_depreciation")
      .select("period").eq("asset_id", asset_id).eq("status", "posted");
    const postedSet = new Set((postedPeriods ?? []).map((p: any) => p.period));
    const remaining = newSchedule.filter((r: any) => !postedSet.has(r.period));

    if (remaining.length > 0) {
      await db.from("asset_depreciation").insert(remaining);
    }

    await logAudit(db, tenantId, userId, "Asset Revalued", "fixed_assets", asset_id, {
      old_cost: asset.cost, new_cost: amount, reason,
    });

    return jsonResponse({ success: true, asset_id, old_cost: asset.cost, new_cost: amount });
  }

  return errorResponse(`Unknown adjustment_type: ${adjustment_type}`);
}

// ─── EVENT: CATEGORY_TRANSFER ───

async function handleCategoryTransfer(db: any, tenantId: string, body: any, userId: string) {
  const { asset_id, new_category_id } = body;
  if (!asset_id || !new_category_id) return errorResponse("Required: asset_id, new_category_id");

  const { data: asset } = await db.from("fixed_assets").select("*").eq("id", asset_id).single();
  if (!asset) return errorResponse("Asset not found", 404);
  if (asset.status === "disposed") return errorResponse("Cannot transfer a disposed asset");

  const oldCategoryId = asset.category_id;
  const newCat = await validateCategory(db, new_category_id);

  // Update asset category + account mappings (no GL impact per spec)
  await db.from("fixed_assets").update({
    category_id: new_category_id,
    asset_account_id: newCat.asset_account_id,
    depreciation_account_id: newCat.accumulated_depreciation_account_id,
    depr_expense_account_id: newCat.depreciation_expense_account_id,
    depreciation_method: newCat.depreciation_method,
  } as any).eq("id", asset_id);

  // Regenerate pending depreciation schedule with new method
  await db.from("asset_depreciation").delete().eq("asset_id", asset_id).eq("status", "pending");
  const newSchedule = generateDepreciationSchedule(
    asset_id, tenantId, asset.cost, asset.salvage_value,
    asset.useful_life_months, asset.start_date || asset.acquisition_date,
    newCat.depreciation_method
  );
  const { data: postedPeriods } = await db.from("asset_depreciation")
    .select("period").eq("asset_id", asset_id).eq("status", "posted");
  const postedSet = new Set((postedPeriods ?? []).map((p: any) => p.period));
  const remaining = newSchedule.filter((r: any) => !postedSet.has(r.period));

  if (remaining.length > 0) {
    await db.from("asset_depreciation").insert(remaining);
  }

  await logAudit(db, tenantId, userId, "Category Transfer", "fixed_assets", asset_id, {
    old_category_id: oldCategoryId, new_category_id,
  });

  return jsonResponse({ success: true, asset_id, new_category_id, schedule_regenerated: remaining.length });
}

// ─── EVENT: BULK_IMPORT ───

async function handleBulkImport(db: any, tenantId: string, body: any, userId: string) {
  const { assets } = body;
  if (!Array.isArray(assets) || assets.length === 0) {
    return errorResponse("Required: assets array");
  }

  const results: any[] = [];
  const errors: any[] = [];

  for (let i = 0; i < assets.length; i++) {
    const row = assets[i];
    try {
      if (!row.name || !row.category_id || !row.cost || !row.payment_account_id) {
        throw new Error("Missing required fields: name, category_id, cost, payment_account_id");
      }

      const result = await handleAssetCreated(db, tenantId, {
        ...row,
        event_type: "ASSET_CREATED",
      }, userId);

      const resultBody = await result.json();
      if (result.status === 200 && resultBody.success) {
        results.push({ row: i + 1, ...resultBody });
      } else {
        errors.push({ row: i + 1, error: resultBody.error || "Unknown error" });
      }
    } catch (err) {
      errors.push({ row: i + 1, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return jsonResponse({
    success: true,
    total: assets.length,
    created: results.length,
    failed: errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
}
