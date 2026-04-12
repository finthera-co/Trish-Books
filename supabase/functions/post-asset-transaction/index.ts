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

    // Auth client to get user
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) return errorResponse("Unauthorized", 401);

    // Service client for privileged operations
    const db = createClient(supabaseUrl, serviceKey);

    // Get tenant
    const { data: appUser } = await db
      .from("users")
      .select("tenant_id")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser) return errorResponse("User not found", 404);
    const tenantId = appUser.tenant_id;

    const body = await req.json();
    const { event_type } = body;

    switch (event_type) {
      case "ASSET_CREATED":
        return await handleAssetCreated(db, tenantId, body, user.id);
      case "DEPRECIATION_POSTED":
        return await handleDepreciationPosted(db, tenantId, body, user.id);
      case "ASSET_DISPOSED":
        return await handleAssetDisposed(db, tenantId, body, user.id);
      default:
        return errorResponse(`Unknown event_type: ${event_type}`);
    }
  } catch (e) {
    console.error("post-asset-transaction error:", e);
    return errorResponse(e.message || "Internal error", 500);
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
    lines: Array<{ account_id: string; debit: number; credit: number; asset_id?: string }>;
  }
) {
  // Validate double-entry balance
  const totalDebit = opts.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = opts.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(`Journal unbalanced: Dr ${totalDebit} != Cr ${totalCredit}`);
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

// ─── EVENT: ASSET_CREATED ───

async function handleAssetCreated(db: any, tenantId: string, body: any, userId: string) {
  const { name, category_id, cost, salvage_value, useful_life_months, purchase_date, depreciation_start_date, payment_account_id, description } = body;

  // Input validation
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

  // Validate category + accounts
  const cat = await validateCategory(db, category_id);
  await validateAccountActive(db, cat.asset_account_id, "Asset");
  await validateAccountActive(db, cat.accumulated_depreciation_account_id, "Accum. Depreciation");
  await validateAccountActive(db, cat.depreciation_expense_account_id, "Depreciation Expense");
  await validateAccountActive(db, payment_account_id, "Payment");
  await validatePeriodOpen(db, tenantId, pDate);

  // 1. Create asset record (no account IDs stored — resolved via category)
  const { data: asset, error: assetErr } = await db
    .from("fixed_assets")
    .insert({
      tenant_id: tenantId,
      asset_name: name,
      description: description || null,
      category_id: category_id,
      asset_account_id: cat.asset_account_id,
      depreciation_account_id: cat.accumulated_depreciation_account_id,
      depr_expense_account_id: cat.depreciation_expense_account_id,
      cost: cost,
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
    description: `Asset Acquisition - ${name}`,
    sourceType: "asset_acquisition",
    sourceId: asset.id,
    createdBy: userId,
    lines: [
      { account_id: cat.asset_account_id, debit: cost, credit: 0, asset_id: asset.id },
      { account_id: payment_account_id, debit: 0, credit: cost },
    ],
  });

  // 3. Insert subledger entry
  // Get the debit journal line id
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
    cost: cost,
    salvage: sv,
    life_years: Math.round(lifeMonths / 12),
    transaction_type: "acquisition",
  } as any);

  // 4. Generate full depreciation schedule
  const schedule = generateDepreciationSchedule(
    asset.id,
    tenantId,
    cost,
    sv,
    lifeMonths,
    dStart,
    cat.depreciation_method
  );

  if (schedule.length > 0) {
    const { error: schedErr } = await db.from("asset_depreciation").insert(schedule);
    if (schedErr) console.error("Schedule generation warning:", schedErr.message);
  }

  return jsonResponse({
    success: true,
    asset_id: asset.id,
    journal_entry_id: jeId,
    schedule_rows: schedule.length,
  });
}

// ─── DEPRECIATION SCHEDULE GENERATOR ───

function generateDepreciationSchedule(
  assetId: string,
  tenantId: string,
  cost: number,
  salvageValue: number,
  lifeMonths: number,
  startDate: string,
  method: string
) {
  const records: any[] = [];
  const depreciableBase = cost - salvageValue;
  if (depreciableBase <= 0 || lifeMonths <= 0) return records;

  const monthlyDep = method === "straight_line"
    ? depreciableBase / lifeMonths
    : depreciableBase / lifeMonths; // fallback to straight-line

  let accumulated = 0;
  const [startYear, startMonth] = startDate.split("-").map(Number);

  for (let i = 0; i < lifeMonths; i++) {
    const month = ((startMonth - 1 + i) % 12) + 1;
    const year = startYear + Math.floor((startMonth - 1 + i) / 12);
    const period = `${year}-${String(month).padStart(2, "0")}`;

    let dep = monthlyDep;
    const currentNBV = cost - accumulated;

    if (currentNBV <= salvageValue) break;
    if (currentNBV - dep < salvageValue) {
      dep = currentNBV - salvageValue;
    }
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

// ─── EVENT: DEPRECIATION_POSTED ───

async function handleDepreciationPosted(db: any, tenantId: string, body: any, userId: string) {
  const { period } = body;
  if (!period) return errorResponse("Required: period (YYYY-MM)");

  await validatePeriodOpen(db, tenantId, `${period}-01`);

  // Get all pending depreciation rows for this period
  const { data: rows, error: rErr } = await db
    .from("asset_depreciation")
    .select("*, fixed_assets!inner(id, asset_name, category_id, cost, salvage_value, asset_account_id, depreciation_account_id, depr_expense_account_id, status, category_id)")
    .eq("tenant_id", tenantId)
    .eq("period", period)
    .eq("status", "pending");

  if (rErr) throw new Error(`Failed to fetch schedule: ${rErr.message}`);
  if (!rows || rows.length === 0) {
    return jsonResponse({ success: true, processed: 0, skipped: 0, message: "No pending depreciation for this period" });
  }

  let processed = 0;
  let skipped = 0;

  for (const row of rows) {
    const asset = row.fixed_assets;
    if (!asset || asset.status !== "active") {
      skipped++;
      continue;
    }

    // Resolve accounts from category if available, fallback to asset-level
    let expenseAccountId = asset.depr_expense_account_id;
    let accumAccountId = asset.depreciation_account_id;

    if (asset.category_id) {
      const { data: cat } = await db
        .from("asset_categories")
        .select("depreciation_expense_account_id, accumulated_depreciation_account_id")
        .eq("id", asset.category_id)
        .single();
      if (cat) {
        expenseAccountId = cat.depreciation_expense_account_id || expenseAccountId;
        accumAccountId = cat.accumulated_depreciation_account_id || accumAccountId;
      }
    }

    if (!expenseAccountId || !accumAccountId) {
      console.error(`Asset ${asset.id} missing depreciation accounts, skipping`);
      skipped++;
      continue;
    }

    // Post journal
    const jeId = await createJournal(db, tenantId, {
      date: `${period}-01`,
      description: `Depreciation - ${asset.asset_name} (${period})`,
      sourceType: "depreciation",
      sourceId: asset.id,
      createdBy: userId,
      lines: [
        { account_id: expenseAccountId, debit: row.depreciation_amount, credit: 0, asset_id: asset.id },
        { account_id: accumAccountId, debit: 0, credit: row.depreciation_amount, asset_id: asset.id },
      ],
    });

    // Update schedule row
    await db
      .from("asset_depreciation")
      .update({ status: "posted", journal_entry_id: jeId })
      .eq("id", row.id);

    // Update asset accumulated_depreciation
    await db
      .from("fixed_assets")
      .update({ accumulated_depreciation: row.accumulated_depreciation })
      .eq("id", asset.id);

    // Insert subledger entry
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

    processed++;
  }

  return jsonResponse({ success: true, processed, skipped });
}

// ─── EVENT: ASSET_DISPOSED ───

async function handleAssetDisposed(db: any, tenantId: string, body: any, userId: string) {
  const { asset_id, sale_price, cash_account_id } = body;
  if (!asset_id || sale_price === undefined || !cash_account_id) {
    return errorResponse("Required: asset_id, sale_price, cash_account_id");
  }

  // Fetch asset
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

  // Resolve accounts from category
  let assetAccountId = asset.asset_account_id;
  let accumAccountId = asset.depreciation_account_id;
  let gainAccountId: string | null = null;
  let lossAccountId: string | null = null;

  if (asset.category_id) {
    const { data: cat } = await db
      .from("asset_categories")
      .select("*")
      .eq("id", asset.category_id)
      .single();
    if (cat) {
      assetAccountId = cat.asset_account_id || assetAccountId;
      accumAccountId = cat.accumulated_depreciation_account_id || accumAccountId;
      gainAccountId = cat.disposal_gain_account_id;
      lossAccountId = cat.disposal_loss_account_id;
    }
  }

  if (!assetAccountId) return errorResponse("Asset account not configured");

  // Compute NBV (system-only, never from user input)
  const accumDepr = asset.accumulated_depreciation ?? 0;
  const nbv = asset.cost - accumDepr;
  const gainLoss = sale_price - nbv;

  // Build journal lines
  const lines: Array<{ account_id: string; debit: number; credit: number; asset_id?: string }> = [];

  // Dr Cash for sale proceeds
  if (sale_price > 0) {
    lines.push({ account_id: cash_account_id, debit: sale_price, credit: 0 });
  }

  // Dr Accumulated Depreciation (remove contra)
  if (accumAccountId && accumDepr > 0) {
    lines.push({ account_id: accumAccountId, debit: accumDepr, credit: 0, asset_id: asset_id });
  }

  // Cr Asset Account (remove full cost)
  lines.push({ account_id: assetAccountId, debit: 0, credit: asset.cost, asset_id: asset_id });

  // Gain or Loss
  if (gainLoss > 0) {
    const acctId = gainAccountId || assetAccountId;
    lines.push({ account_id: acctId, debit: 0, credit: gainLoss });
  } else if (gainLoss < 0) {
    const acctId = lossAccountId || assetAccountId;
    lines.push({ account_id: acctId, debit: Math.abs(gainLoss), credit: 0 });
  }

  const jeId = await createJournal(db, tenantId, {
    date: today,
    description: `Asset Disposal - ${asset.asset_name}`,
    sourceType: "asset_disposal",
    sourceId: asset_id,
    createdBy: userId,
    lines,
  });

  // Record disposal
  await db.from("asset_disposals").insert({
    asset_id,
    tenant_id: tenantId,
    disposal_date: today,
    sale_value: sale_price,
    gain_loss: gainLoss,
    journal_entry_id: jeId,
  } as any);

  // Mark asset disposed
  await db.from("fixed_assets").update({ status: "disposed" }).eq("id", asset_id);

  // Cancel pending depreciation schedule
  await db
    .from("asset_depreciation")
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

  return jsonResponse({
    success: true,
    asset_id,
    journal_entry_id: jeId,
    gain_loss: gainLoss,
    nbv,
  });
}
