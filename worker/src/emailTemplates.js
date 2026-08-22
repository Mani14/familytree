// Deliberately plain, personal-looking HTML (inline styles only — Gmail/Outlook
// strip <style> blocks): a simple text note with a normal text link, NOT a
// gradient banner + emoji + big CTA button. Those "marketing" signals are exactly
// what pushed this into Gmail's Promotions tab; a plainer, letter-style email is
// far more likely to land in Primary.

const CONTAINER_STYLE = "max-width:480px;margin:0 auto;padding:8px 16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#222222;";
const LINK_STYLE = 'color:#1a56db;';

function wrap(innerHtml) {
  return `<div style="${CONTAINER_STYLE}">${innerHtml}</div>`;
}

// Names come from person records anyone in the family can edit — escaping
// before dropping them into email HTML is cheap insurance against a name
// containing `<`/`&` breaking the layout, not a defense against a hostile
// user (this is a shared family app, not a public form).
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function birthdayPersonEmail({ firstName: rawFirstName, appUrl }) {
  const firstName = escapeHtml(rawFirstName);
  const html = wrap(`
    <p>Hi ${firstName},</p>
    <p>Wishing you a very happy birthday! Your family is thinking of you today.</p>
    <p>You can open the family tree here: <a href="${appUrl}" style="${LINK_STYLE}">${appUrl}</a></p>
    <p>&mdash; Family Tree</p>
  `);
  return { subject: `Happy birthday, ${rawFirstName}`, html };
}

export function birthdayNotifyEmail({ firstName: rawFirstName, lastName: rawLastName, appUrl }) {
  const firstName = escapeHtml(rawFirstName);
  const fullName = [firstName, escapeHtml(rawLastName)].filter(Boolean).join(' ');
  const html = wrap(`
    <p>Hi,</p>
    <p>Today is ${fullName}'s birthday. Do take a moment to wish them!</p>
    <p>You can open the family tree here: <a href="${appUrl}" style="${LINK_STYLE}">${appUrl}</a></p>
    <p>&mdash; Family Tree</p>
  `);
  return { subject: `Today is ${rawFirstName}'s birthday`, html };
}
