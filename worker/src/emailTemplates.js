// Email HTML uses inline styles throughout, not a <style> block or external
// CSS — most email clients (Gmail, Outlook) strip <style> tags or support
// them inconsistently, so every rule that matters has to live on the element
// itself. SVG images are deliberately avoided entirely: Gmail, Outlook, and
// Yahoo all fail to render inline SVG (shows a broken-image icon), so the
// "cake with a name on it" effect is built from a plain emoji (which Gmail/
// Apple Mail render as real colorful glyphs, no image file needed) plus a
// styled text banner underneath, rather than text baked into image pixels.

const CARD_STYLE = 'max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #f0d9e4;font-family:Georgia,\'Times New Roman\',serif;';
const HEADER_STYLE = 'background:linear-gradient(135deg,#f472b6,#a855f7);padding:28px 20px;text-align:center;';
const BODY_STYLE = 'padding:28px 24px;text-align:center;color:#4b3350;';
const NAME_BANNER_STYLE = 'display:inline-block;margin:8px 0 18px;padding:8px 22px;background:#fdf0f6;border:2px dashed #e879b9;border-radius:999px;font-size:22px;font-weight:bold;color:#a3266b;';
const BUTTON_STYLE = 'display:inline-block;margin-top:8px;padding:12px 28px;background:#a855f7;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:bold;font-size:14px;font-family:Georgia,serif;';
const WRAPPER_STYLE = 'background:#fbeff5;padding:32px 16px;';

function wrap(innerHtml) {
  return `<div style="${WRAPPER_STYLE}"><div style="${CARD_STYLE}">${innerHtml}</div></div>`;
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
    <div style="${HEADER_STYLE}">
      <div style="font-size:48px;line-height:1;">🎂🎉</div>
      <div style="font-size:22px;font-weight:bold;color:#ffffff;margin-top:8px;">Happy Birthday!</div>
    </div>
    <div style="${BODY_STYLE}">
      <div style="${NAME_BANNER_STYLE}">🎈 ${firstName} 🎈</div>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Wishing you a wonderful day, ${firstName}! Your family is thinking of
        you today.
      </p>
      <a href="${appUrl}" style="${BUTTON_STYLE}">🌳 Open Family Tree</a>
    </div>
  `);
  return { subject: `🎉 Happy Birthday, ${rawFirstName}!`, html };
}

export function birthdayNotifyEmail({ firstName: rawFirstName, lastName: rawLastName, appUrl }) {
  const firstName = escapeHtml(rawFirstName);
  const fullName = [firstName, escapeHtml(rawLastName)].filter(Boolean).join(' ');
  const html = wrap(`
    <div style="${HEADER_STYLE}">
      <div style="font-size:48px;line-height:1;">🎂🥳</div>
      <div style="font-size:22px;font-weight:bold;color:#ffffff;margin-top:8px;">Today's the Day!</div>
    </div>
    <div style="${BODY_STYLE}">
      <div style="${NAME_BANNER_STYLE}">🎈 ${fullName} 🎈</div>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
        Today is <strong>${fullName}</strong>'s birthday!
      </p>
      <a href="${appUrl}" style="${BUTTON_STYLE}">🌳 Open Family Tree</a>
    </div>
  `);
  return { subject: `🎂 Today is ${rawFirstName}'s birthday`, html };
}
