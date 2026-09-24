// Supabase Edge Function: bank-fetch-transactions
// Haalt voor elke gekoppelde betaalrekening nieuwe transacties op bij Enable Banking
// (sinds last_synced_date) en zet ze in bank_transactions_staging.
//
// Gebruikt de SERVICE ROLE key (server-side, automatisch door Supabase beschikbaar
// gesteld aan elke Edge Function) om enable_banking_session_id te kunnen lezen —
// die kolom is voor de publieke anon-key afgeschermd (zie de RLS/kolom-migratie).
//
// Dit bestand staat volledig op zichzelf — geen andere bestanden nodig.

const ENABLE_BANKING_APP_ID = "49ee790f-9d31-408b-9756-98bcc6fd0d38";
const FIRST_SYNC_DATE = "2026-08-29"; // vaste afspraak: eerste keer vanaf deze datum
const MAX_PAGES_PER_ACCOUNT = 20; // veiligheidsgrens tegen oneindige continuation_key-loops

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(appId: string, privateKeyPem: string): Promise<string> {
  const header = { typ: "JWT", alg: "RS256", kid: appId };
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const keyBuffer = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(signature)}`;
}

type LinkedAccount = {
  id: number;
  enable_banking_account_uid: string;
  last_synced_date: string | null;
};

async function fetchLinkedAccounts(supabaseUrl: string, serviceKey: string): Promise<LinkedAccount[]> {
  const url = `${supabaseUrl}/rest/v1/accounts?type=eq.checking&enable_banking_account_uid=not.is.null&select=id,enable_banking_account_uid,enable_banking_session_id,last_synced_date`;
  const resp = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!resp.ok) throw new Error(`Kon accounts niet lezen: ${resp.status} ${await resp.text()}`);
  const rows = await resp.json();
  // session_id zelf hebben we niet meer nodig als apart veld in de respons naar de browser toe,
  // maar wel binnen deze functie om te bepalen of een account gekoppeld is; filter alsnog expliciet.
  return rows.filter((r: any) => !!r.enable_banking_session_id);
}

async function updateLastSyncedDate(supabaseUrl: string, serviceKey: string, accountId: number, date: string) {
  const url = `${supabaseUrl}/rest/v1/accounts?id=eq.${accountId}`;
  await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ last_synced_date: date }),
  });
}

async function upsertStagingRows(supabaseUrl: string, serviceKey: string, rows: any[]) {
  if (rows.length === 0) return;
  const url = `${supabaseUrl}/rest/v1/bank_transactions_staging?on_conflict=account_id,bank_transaction_id`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) throw new Error(`Kon staging-rijen niet wegschrijven: ${resp.status} ${await resp.text()}`);
}

function mapTransaction(t: any, accountId: number): any {
  const isDebit = t.credit_debit_indicator === "DBIT";
  const amountAbs = parseFloat(t.transaction_amount?.amount ?? "0");
  const amount = isDebit ? -Math.abs(amountAbs) : Math.abs(amountAbs);
  const payee = (isDebit ? t.creditor?.name : t.debtor?.name) || null;
  const date = t.booking_date || t.value_date || t.transaction_date || null;
  const bankTransactionId = t.entry_reference ||
    `synth_${date}_${t.transaction_amount?.amount}_${(t.remittance_information || []).join("|")}`;
  return {
    account_id: accountId,
    bank_transaction_id: bankTransactionId,
    date,
    amount,
    payee,
    raw_description: (t.remittance_information || []).join(" "),
    fetched_at: new Date().toISOString(),
  };
}

async function fetchTransactionsForAccount(jwt: string, accountUid: string, dateFrom: string): Promise<any[]> {
  const all: any[] = [];
  let continuationKey: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_ACCOUNT; page++) {
    const params = new URLSearchParams({ date_from: dateFrom });
    if (continuationKey) params.set("continuation_key", continuationKey);
    const resp = await fetch(`https://api.enablebanking.com/accounts/${accountUid}/transactions?${params}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!resp.ok) {
      const detail = await resp.text();
      const err: any = new Error(`Enable Banking gaf status ${resp.status} terug`);
      err.status = resp.status;
      err.detail = detail;
      throw err;
    }
    const data = await resp.json();
    const booked = (data.transactions || []).filter((t: any) => !t.status || t.status === "BOOK");
    all.push(...booked);
    continuationKey = data.continuation_key;
    if (!continuationKey) break;
  }
  return all;
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const privateKey = Deno.env.get("ENABLE_BANKING_PRIVATE_KEY");

  if (!supabaseUrl || !serviceKey || !privateKey) {
    return new Response(
      JSON.stringify({ error: "Server niet correct geconfigureerd (env vars ontbreken)" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let accounts: LinkedAccount[];
  try {
    accounts = await fetchLinkedAccounts(supabaseUrl, serviceKey);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];

  for (const acc of accounts) {
    const dateFrom = acc.last_synced_date || FIRST_SYNC_DATE;
    try {
      const jwt = await signJwt(ENABLE_BANKING_APP_ID, privateKey);
      const transactions = await fetchTransactionsForAccount(jwt, acc.enable_banking_account_uid, dateFrom);
      const rows = transactions.map((t) => mapTransaction(t, acc.id));
      await upsertStagingRows(supabaseUrl, serviceKey, rows);
      const today = new Date().toISOString().slice(0, 10);
      await updateLastSyncedDate(supabaseUrl, serviceKey, acc.id, today);
      results.push({ account_id: acc.id, status: "ok", new_count: rows.length });
    } catch (e: any) {
      if (e && e.status === 401) {
        results.push({ account_id: acc.id, status: "consent_expired" });
      } else if (e && e.status === 429) {
        results.push({ account_id: acc.id, status: "rate_limited", detail: "Max. 4 ophaal-verzoeken per rekening per dag (PSD2-regel); probeer het later opnieuw." });
      } else {
        // Sinds v3.68: ook de antwoordtekst van Enable Banking meesturen (ingekort), zodat in de app
        // te zien is wat de bank precies teruggaf i.p.v. alleen het statusnummer.
        const msg = (e && e.message) || String(e);
        const body = e && e.detail ? ` — ${String(e.detail).replace(/\s+/g, " ").slice(0, 300)}` : "";
        results.push({ account_id: acc.id, status: "error", detail: msg + body });
      }
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// @ts-ignore - Deno global, aanwezig in de Supabase Edge Function-runtime
Deno.serve(handleRequest);
