// Progress is derived only from server-owned device ingestion records.
// Browser manual entries, pairing callbacks and dry-run probes are not receipts.
// This is onboarding evidence, NOT attestation that iOS fired a native NFC trigger.

function receipt(event, source, userId, deviceId) {
  if (!event || event.user_id !== userId || event.device_id !== deviceId) return null;
  if (event.payload?.source !== source) return null;
  const committed = event.status === "processed";
  const savedPending = event.status === "needs_review" && Boolean(event.transaction_id);
  if (!committed && !savedPending) return null;
  if (source === "manual" && !committed) return null;
  return {
    received_at: event.received_at,
    transaction_id: event.transaction_id || null,
    needs_review: !committed || (source === "apple_pay" && !event.payload?.account_id),
  };
}

export function deviceReadiness(userId, device, manualEvent, walletEvent) {
  if (device.revoked_at) return null;
  const manual = receipt(manualEvent, "manual", userId, device.id);
  const wallet = receipt(walletEvent, "apple_pay", userId, device.id);
  const stage = !manual ? "manual_required"
    : !wallet ? "wallet_setup_ready"
      : wallet.needs_review ? "wallet_received_review" : "wallet_receipt_received";
  return { device_id: device.id, stage, manual_receipt: manual, wallet_receipt: wallet,
    can_configure_wallet: Boolean(manual), ios_trigger_attested: false };
}

export async function shortcutReadiness(db, userId, devices) {
  // An active device is required; success on an old/revoked phone cannot unlock a new one.
  const active = devices.filter((device) => !device.revoked_at);
  const result = await Promise.all(active.map(async (device) => {
    const eventFor = async (source) => {
      let query = db.from("ledger_wallet_events")
        .select("user_id,device_id,transaction_id,status,payload,received_at")
        .eq("user_id", userId).eq("device_id", device.id)
        .eq("payload->>source", source);
      query = source === "manual" ? query.eq("status", "processed")
        : query.in("status", ["processed", "needs_review"]);
      const { data, error } = await query.order("received_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    };
    const [manual, wallet] = await Promise.all([eventFor("manual"), eventFor("apple_pay")]);
    return deviceReadiness(userId, device, manual, wallet);
  }));
  // Do not return amounts, raw notification contents, tokens or payloads.
  return { version: 1, evidence: "server_device_receipts", devices: result,
    checked_at: new Date().toISOString(), ios_trigger_attested: false };
}
