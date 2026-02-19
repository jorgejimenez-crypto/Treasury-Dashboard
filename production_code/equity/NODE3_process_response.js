// ============================================
// PROCESS RESPONSE (Daily + Saturday — shared)
// n8n Code Node — Production v3.2
// ============================================
// Converts Claude's Markdown output to HTML email.
// Creates .md binary for Google Drive archive.

var briefText = $input.first().json.briefText;
var subjectLine = $input.first().json.subjectLine;
var date = $input.first().json.date;

// Simple Markdown to HTML
var html = briefText;

// Remove Subject line from body
html = html.replace(/^Subject:.*\n?/im, '');

// Headers
html = html.replace(/^### (.+)$/gm, '<h3 style="margin:18px 0 8px;font-size:15px;color:#1f2937;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">$1</h3>');
html = html.replace(/^## (.+)$/gm, '<h2 style="margin:20px 0 10px;font-size:17px;color:#111827;">$1</h2>');

// Bold and italic
html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
html = html.replace(/\*(.+?)\*/g, '<em style="color:#6b7280;">$1</em>');

// Bullet points
html = html.replace(/^- (.+)$/gm, '<li style="margin:3px 0;font-size:14px;line-height:1.5;">$1</li>');

// Wrap consecutive li in ul
var lines = html.split('\n');
var result = [];
var inList = false;
for (var a = 0; a < lines.length; a++) {
  var line = lines[a].trim();
  if (line.indexOf('<li') === 0) {
    if (!inList) {
      result.push('<ul style="margin:8px 0;padding-left:20px;">');
      inList = true;
    }
    result.push(line);
  } else {
    if (inList) {
      result.push('</ul>');
      inList = false;
    }
    result.push(line);
  }
}
if (inList) result.push('</ul>');
html = result.join('\n');

// Tables
html = html.replace(/\|(.+)\|/g, function(match) {
  var cells = match.split('|').filter(function(c) { return c.trim() !== ''; });
  var isSep = cells.every(function(c) { return /^[\s\-:]+$/.test(c); });
  if (isSep) return '';
  var cellHtml = cells.map(function(c) {
    return '<td style="padding:4px 10px;border:1px solid #e5e7eb;font-size:13px;font-family:monospace;">' + c.trim() + '</td>';
  }).join('');
  return '<tr>' + cellHtml + '</tr>';
});

// Wrap tr in table
var lines2 = html.split('\n');
var result2 = [];
var inTable = false;
for (var b = 0; b < lines2.length; b++) {
  var line2 = lines2[b].trim();
  if (line2.indexOf('<tr>') === 0) {
    if (!inTable) {
      result2.push('<table style="border-collapse:collapse;margin:10px 0;width:100%;max-width:520px;">');
      inTable = true;
    }
    result2.push(line2);
  } else {
    if (inTable) {
      result2.push('</table>');
      inTable = false;
    }
    result2.push(line2);
  }
}
if (inTable) result2.push('</table>');
html = result2.join('\n');

// Horizontal rules
html = html.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #d1d5db;margin:16px 0;">');

// Wrap remaining text in p tags
var lines3 = html.split('\n');
var result3 = [];
for (var c = 0; c < lines3.length; c++) {
  var line3 = lines3[c].trim();
  if (!line3) continue;
  if (line3.charAt(0) === '<') {
    result3.push(line3);
  } else {
    result3.push('<p style="margin:6px 0;font-size:14px;line-height:1.6;color:#1f2937;">' + line3 + '</p>');
  }
}
html = result3.join('\n');

// Wrap in email template
var emailHtml = '<div style="font-family:Georgia,serif;max-width:680px;margin:0 auto;color:#1a1a1a;line-height:1.6;padding:20px;">'
  + '<div style="border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin-bottom:20px;">'
  + '<h2 style="margin:0;font-size:18px;letter-spacing:0.5px;">' + subjectLine + '</h2>'
  + '<p style="margin:4px 0 0;font-size:12px;color:#666;">' + date + ' | Jorge\'s AI Equity Earpiece Analyst</p>'
  + '</div>'
  + html
  + '<div style="border-top:1px solid #ccc;margin-top:30px;padding-top:12px;font-size:11px;color:#888;">'
  + '<p>This is not financial advice. Do your own research.</p>'
  + '</div>'
  + '</div>';

var filename = subjectLine.indexOf('Saturday') !== -1
  ? 'Saturday_Deep_Dive_' + date
  : 'Daily_Brief_' + date;

// Create binary data for Google Drive upload
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
