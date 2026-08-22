// Brevo, not Resend — Resend's shared sandbox sender turned out to only
// deliver to the Resend account's OWN registered email until a domain is
// verified (a real, hard 403 for any other recipient — confirmed by testing,
// not assumed). Brevo's permanent free tier (300/day, never expires) supports
// verifying a single sender EMAIL address instead of a whole domain, which is
// enough to send to arbitrary recipients — Brevo itself only warns (doesn't
// block) that a freemail sender lacks the DKIM/DMARC alignment Gmail/Yahoo/
// Microsoft now recommend, which may affect spam-folder placement but not
// whether the send succeeds. Swap FROM_ADDRESS for a verified custom domain
// later if deliverability becomes an actual problem.
// Sends from the Brevo-authenticated custom domain (familyroots.co.in), so DKIM
// and DMARC align with the From domain — the freemail sender it replaced
// (@gmail.com via Brevo) couldn't align, which hurt inbox/Primary placement.
const FROM_NAME = 'Family Tree';
const FROM_EMAIL = 'noreply@familyroots.co.in';

export async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo send to ${to} failed: ${res.status} ${body.slice(0, 200)}`);
  }
}
