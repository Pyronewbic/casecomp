import { Resend } from "resend";

const FROM_ADDRESS = "Casecomp Alerts <alerts@casecomp.xyz>";
const FALLBACK_FROM = "Casecomp Alerts <onboarding@resend.dev>";

let resend = null;

function getClient() {
  if (resend) return resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resend = new Resend(key);
  return resend;
}

export function buildAlertEmailSubject(alert, triggerData) {
  if (alert.type === "arbitrage") {
    return `Arbitrage alert: ${alert.query} spread ${triggerData.spreadPct}%`;
  }
  return `Price alert: ${alert.query} below $${triggerData.currentPrice}`;
}

function buildPriceEmailHtml(alert, triggerData) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07070a;font-family:'Inter Tight',Inter,system-ui,sans-serif;color:#e0e0e0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07070a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0c0d12;border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 8px;font-family:'Space Grotesk',system-ui,sans-serif;font-size:20px;letter-spacing:-0.02em;color:#d9b676;">Price Alert Triggered</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#999;">${alert.query}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#14151c;border-radius:6px;border:1px solid rgba(255,255,255,0.08);">
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:12px;color:#999;font-family:'JetBrains Mono',monospace;">CURRENT PRICE</span><br>
                <span style="font-size:24px;font-weight:600;color:#7ce0a8;">$${triggerData.currentPrice}</span>
              </td>
              <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:12px;color:#999;font-family:'JetBrains Mono',monospace;">YOUR TARGET</span><br>
                <span style="font-size:24px;font-weight:600;color:#d9b676;">$${alert.targetPrice}</span>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding:16px 20px;">
                <span style="font-size:12px;color:#999;font-family:'JetBrains Mono',monospace;">SOURCE</span><br>
                <span style="font-size:14px;color:#e0e0e0;">eBay</span>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0;font-size:12px;color:#666;">Casecomp -- casecomp.xyz</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildArbitrageEmailHtml(alert, triggerData) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07070a;font-family:'Inter Tight',Inter,system-ui,sans-serif;color:#e0e0e0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07070a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0c0d12;border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 8px;font-family:'Space Grotesk',system-ui,sans-serif;font-size:20px;letter-spacing:-0.02em;color:#d9b676;">Arbitrage Alert Triggered</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#999;">${alert.query}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#14151c;border-radius:6px;border:1px solid rgba(255,255,255,0.08);">
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:12px;color:#999;font-family:'JetBrains Mono',monospace;">CHEAPEST</span><br>
                <span style="font-size:20px;font-weight:600;color:#7ce0a8;">$${triggerData.cheapestPrice}</span>
                <span style="font-size:13px;color:#999;margin-left:8px;">${triggerData.cheapestSource}</span>
              </td>
              <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">
                <span style="font-size:12px;color:#999;font-family:'JetBrains Mono',monospace;">MOST EXPENSIVE</span><br>
                <span style="font-size:20px;font-weight:600;color:#ff5d5d;">$${triggerData.mostExpensivePrice}</span>
                <span style="font-size:13px;color:#999;margin-left:8px;">${triggerData.mostExpensiveSource}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;">
                <span style="font-size:12px;color:#999;font-family:'JetBrains Mono',monospace;">SPREAD</span><br>
                <span style="font-size:24px;font-weight:600;color:#d9b676;">$${triggerData.spread} (${triggerData.spreadPct}%)</span>
              </td>
              <td style="padding:16px 20px;">
                <span style="font-size:12px;color:#999;font-family:'JetBrains Mono',monospace;">THRESHOLD</span><br>
                <span style="font-size:24px;font-weight:600;color:#999;">${triggerData.threshold}%</span>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0;font-size:12px;color:#666;">Casecomp -- casecomp.xyz</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendAlertEmail(alert, triggerData) {
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY not set, skipping email notification");
    return { skipped: true, reason: "no_api_key" };
  }

  const subject = buildAlertEmailSubject(alert, triggerData);
  const html = alert.type === "arbitrage"
    ? buildArbitrageEmailHtml(alert, triggerData)
    : buildPriceEmailHtml(alert, triggerData);

  const from = process.env.RESEND_VERIFIED_DOMAIN ? FROM_ADDRESS : FALLBACK_FROM;

  try {
    const { data, error } = await client.emails.send({
      from,
      to: [alert.email],
      subject,
      html,
    });

    if (error) {
      console.error(`[email] Resend error for ${alert.email}:`, error.message);
      return { sent: false, error: error.message };
    }

    return { sent: true, id: data.id };
  } catch (e) {
    console.error(`[email] Failed to send to ${alert.email}:`, e.message);
    return { sent: false, error: e.message };
  }
}
