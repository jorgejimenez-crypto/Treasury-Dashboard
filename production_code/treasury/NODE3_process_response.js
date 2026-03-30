// ============================================
// PROCESS RESPONSE — TREASURY (Daily + Saturday)
// n8n Code Node — Production v4.1
// Fixes: table separator bug, removed dead chart embed logic
// ============================================

var briefText = $input.first().json.briefText;
var subjectLine = $input.first().json.subjectLine;
var date = $input.first().json.date;

var html = briefText;

// Strip subject line
html = html.replace(/^Subject:.*\n?/im, '');

// Headers
html = html.replace(/^### (.+)$/gm, '<h3 style="margin:18px 0 8px;font-size:15px;color:#1f2937;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">$1</h3>');
html = html.replace(/^## (.+)$/gm, '<h2 style="margin:20px 0 10px;font-size:17px;color:#111827;">$1</h2>');

// Inline formatting
html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
html = html.replace(/\*(.+?)\*/g, '<em style="color:#6b7280;">$1</em>');

// Bullet points
html = html.replace(/^- (.+)$/gm, '<li style="margin:3px 0;font-size:14px;line-height:1.5;">$1</li>');

// Wrap bullet lists
var lines = html.split('\n');
var result = [];
var inList = false;
for (var a = 0; a < lines.length; a++) {
  var line = lines[a].trim();
  if (line.indexOf('<li') === 0) {
    if (!inList) { result.push('<ul style="margin:8px 0;padding-left:20px;">'); inList = true; }
    result.push(line);
  } else {
    if (inList) { result.push('</ul>'); inList = false; }
    result.push(line);
  }
}
if (inList) result.push('</ul>');
html = result.join('\n');

// TABLE PROCESSING — run BEFORE --- replacement to prevent separator rows
// becoming <hr> tags before the table regex sees them.
// First pass: strip separator rows entirely, convert data rows to <tr>
html = html.replace(/\|(.+)\|/g, function(match) {
  var cells = match.split('|').filter(function(c) { return c.trim() !== ''; });
  var isSep = cells.every(function(c) { return /^[\s\-:]+$/.test(c); });
  if (isSep) return '';
  var isHeader = false;
  var cellHtml = cells.map(function(c, idx) {
    var tag = (idx === 0 && isHeader) ? 'th' : 'td';
    return '<td style="padding:6px 12px;border:1px solid #e5e7eb;font-size:13px;font-family:monospace;vertical-align:top;">' + c.trim() + '</td>';
  }).join('');
  return '<tr>' + cellHtml + '</tr>';
});

// Wrap consecutive <tr> blocks in <table>
var lines2 = html.split('\n');
var result2 = [];
var inTable = false;
for (var b = 0; b < lines2.length; b++) {
  var line2 = lines2[b].trim();
  if (line2.indexOf('<tr>') === 0) {
    if (!inTable) { result2.push('<table style="border-collapse:collapse;margin:12px 0;width:100%;max-width:560px;">'); inTable = true; }
    result2.push(line2);
  } else {
    if (inTable) { result2.push('</table>'); inTable = false; }
    result2.push(line2);
  }
}
if (inTable) result2.push('</table>');
html = result2.join('\n');

// Horizontal rules — NOW safe to run after table processing
html = html.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #d1d5db;margin:16px 0;">');

// Wrap bare text lines in <p>
var lines3 = html.split('\n');
var result3 = [];
for (var c = 0; c < lines3.length; c++) {
  var line3 = lines3[c].trim();
  if (!line3) continue;
  if (line3.charAt(0) === '<') { result3.push(line3); }
  else { result3.push('<p style="margin:6px 0;font-size:14px;line-height:1.6;color:#1f2937;">' + line3 + '</p>'); }
}
html = result3.join('\n');

// Assemble email
var emailHtml = '<div style="font-family:Georgia,serif;max-width:680px;margin:0 auto;color:#1a1a1a;line-height:1.6;padding:20px;">'
  + '<div style="border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:20px;">'
  + '<h2 style="margin:0;font-size:18px;letter-spacing:0.5px;">' + subjectLine + '</h2>'
  + '<p style="margin:4px 0 0;font-size:12px;color:#666;">' + date + ' | Treasury Intelligence Brief</p>'
  + '</div>'
  + html
  + '<div style="border-top:1px solid #ccc;margin-top:30px;padding-top:12px;font-size:11px;color:#888;">'
  + '<p>This is not financial advice. Internal use only.</p>'
  + '</div>'
  + '</div>';

var filename = subjectLine.indexOf('Weekly') !== -1
  ? 'Weekly_Treasury_Memo_' + date
  : 'Treasury_Brief_' + date;

var binaryData = await this.helpers.prepareBinaryData(
  Buffer.from(briefText, 'utf-8'),
  filename + '.md',
  'text/markdown'
);

return [{
  json: {
    emailSubject: subjectLine,
    emailHtml: emailHtml,
    markdown: briefText,
    filename: filename,
    date: date
  },
  binary: {
    data: binaryData
  }
}];
