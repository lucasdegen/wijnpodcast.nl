import he from 'he';

/** Haalt HTML-tags weg en decodeert entiteiten (bv. &eacute; -> é). */
export function cleanDescription(html) {
  if (!html) return '';
  const withoutTags = html.replace(/<[^>]*>/g, ' ');
  return he.decode(withoutTags).replace(/\s+/g, ' ').trim();
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Zet e-mailadressen en URL's in platte tekst om naar klikbare linkjes. */
export function linkifyDescription(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  html = html.replace(
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    '<a href="mailto:$1">$1</a>'
  );

  html = html.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>'
  );

  return html;
}

export function formatDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  return d
    .toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace('.', '')
    .toUpperCase();
}

export function formatMonthYear(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  return d.toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' }).replace('.', '');
}

/** Zet seconden om naar ISO 8601-duur (bv. PT12M34S), zoals schema.org verwacht. */
export function toIsoDuration(seconds) {
  if (!seconds && seconds !== 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  let iso = 'PT';
  if (h) iso += `${h}H`;
  if (m) iso += `${m}M`;
  if (s || (!h && !m)) iso += `${s}S`;
  return iso;
}

/** Formatteert een datum als "22 jan", met jaartal erbij alleen als dat
 * afwijkt van het huidige jaar (bv. rond de wissel tussen seizoenen). */
export function formatDayDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const base = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }).replace('.', '');
  const currentYear = new Date().getFullYear();
  return d.getFullYear() !== currentYear ? `${base} ${d.getFullYear()}` : base;
}

export function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}u` : `${h}u ${m}min`;
}

export function formatViews(n) {
  if (!n) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}
