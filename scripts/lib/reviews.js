// ============================================================
//  reviews.js — build-side helpers for customer reviews &
//  recommendations. Fetches published rows from Supabase and owns
//  the ONE card renderer used by both the homepage injection
//  (scripts/build-from-supabase.js) and the /reviews/ page
//  (scripts/generate-product-pages.js), so the two never drift —
//  same idea as lib/render-card.js for product cards.
//
//  Terminology (matches migration 013): rating IS NULL means a
//  Facebook "recommends" entry → a *recommendation*, rendered as
//  "Recommends NawmeEssences", never as synthesised stars. Rated
//  entries are *reviews*. Counts and labels keep the two distinct.
// ============================================================
const { publicUrl, imageVersion } = require('./catalog');
const { esc } = require('./render-card');

const SOURCE_LABEL = {
  facebook:  'Facebook recommendation',
  instagram: 'Instagram',
  whatsapp:  'WhatsApp feedback',
  messenger: 'Messenger feedback',
  google:    'Google review',
  website:   'Website review',
  other:     'Customer feedback',
};
const ORIGIN_LABEL = {
  facebook:  'View post',
  instagram: 'View post',
  google:    'View review',
};
const sourceLabel = s => SOURCE_LABEL[s] || SOURCE_LABEL.other;
const originLabel = s => ORIGIN_LABEL[s] || 'View original';

// Fetch published reviews, newest first (by the customer's date, then by
// creation). Resilient: if the reviews table doesn't exist yet (migration 013
// not run), return [] so the build still succeeds — the homepage section is
// simply omitted and /reviews/ renders its empty state.
async function fetchReviews(sb) {
  try {
    const { data, error } = await sb
      .from('reviews')
      .select('id, display_name, body, rating, source, source_url, product_name, reviewed_at, lang, photo, verified, home_slot, updated_at, created_at')
      .eq('status', 'published')
      .order('reviewed_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) {
      console.warn('  ⚠️  reviews not found — run migration 013. Building without reviews.');
      return [];
    }
    return (data || []).map(r => ({
      id:          r.id,
      name:        r.display_name,
      body:        r.body || '',
      rating:      r.rating == null ? null : Number(r.rating),
      source:      r.source || 'other',
      sourceUrl:   r.source_url || '',
      productName: r.product_name || '',
      reviewedAt:  r.reviewed_at || null,
      lang:        r.lang === 'bn' ? 'bn' : 'en',
      photo:       !!r.photo,
      verified:    !!r.verified,
      homeSlot:    r.home_slot == null ? null : Number(r.home_slot),
      updatedAt:   r.updated_at || null,
    }));
  } catch (e) {
    return [];
  }
}

// Photos live under a reviews/ prefix in the same bucket as products —
// same trick as blog covers and brand logos.
function photoUrl(r, size) {
  return publicUrl('reviews/' + r.id, size, imageVersion(r.updatedAt));
}

// "Aug 2026" for the card; full ISO date goes in the datetime attr.
function fmtMonth(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? '' : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

// Stars only when there IS a rating. A Facebook recommendation has none and
// gets no head row at all — the "Facebook recommendation" source line already
// says what it is. Stars are never synthesised for it.
function stars(r) {
  if (!r.rating) return '';
  const n = Math.max(1, Math.min(5, r.rating));
  return `<span class="review-stars" role="img" aria-label="${n} out of 5 stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}

// The uniform, minimal card: quote → name → one muted meta line
// ("Facebook recommendation · Aug 2026 · View post ↗"). A head row is
// emitted only when there is something to put in it (stars / verified).
// `clamp` (homepage) caps the quote at 5 lines via CSS so a row of three
// cards shares one height; the /reviews/ page shows full text. The footer is
// pinned to the bottom (margin-top:auto) so footers align across a row.
function renderReviewCard(r, { clamp = false } = {}) {
  const head = [stars(r), r.verified ? '<span class="review-verified">✓ Verified order</span>' : ''].filter(Boolean).join('');
  // Photos only on the full page: the homepage strip (clamp mode) stays a
  // compact, equal-height row of quotes.
  const photo = r.photo && !clamp
    ? `\n      <img class="review-photo" src="${esc(photoUrl(r, 'thumb'))}" data-large="${esc(photoUrl(r, 'medium'))}" alt="Photo shared by ${esc(r.name)}" loading="lazy" decoding="async" width="450" height="338" onclick="if(typeof openLightbox==='function')openLightbox(this.dataset.large)" onerror="this.style.display='none'">`
    : '';
  // Meta line: "Facebook recommendation · Aug 2026". The origin link always
  // sits on its own line below it, so layout is identical at every width.
  const meta = [
    esc(sourceLabel(r.source)),
    r.reviewedAt ? `<time datetime="${esc(String(r.reviewedAt).slice(0, 10))}">${esc(fmtMonth(r.reviewedAt))}</time>` : '',
  ].filter(Boolean).join('<span class="review-dot" aria-hidden="true">·</span>');
  const origin = r.sourceUrl
    ? `\n        <a class="review-origin" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(originLabel(r.source))} ↗</a>`
    : '';
  const product = r.productName ? `<span class="review-product"> · ${esc(r.productName)}</span>` : '';
  return `
    <article class="review-card" lang="${r.lang}">${head ? `\n      <div class="review-head">${head}</div>` : ''}
      <blockquote class="review-body${clamp ? ' review-body--clamp' : ''}">${esc(r.body)}</blockquote>${photo}
      <footer class="review-foot">
        <div class="review-name">${esc(r.name)}${product}</div>
        <div class="review-meta">${meta}</div>${origin}
      </footer>
    </article>`;
}

// The 3 homepage cards: admin-chosen slots in slot order; if fewer than 3
// slots are set, pad with the newest unslotted so the row is never ragged.
function homepageReviews(reviews, n = 3) {
  if (!reviews.length) return [];
  const slotted = reviews.filter(r => r.homeSlot).sort((a, b) => a.homeSlot - b.homeSlot);
  const rest = reviews.filter(r => !r.homeSlot);   // already newest-first
  return [...slotted, ...rest].slice(0, n);
}

// Counts keep recommendations (no rating) and rated reviews distinct, so the
// chips stay honest as sources grow. recommendPct is only ever rendered as
// "100% recommend" (every entry is a recommendation or rated ≥ 4) — never as
// a "4.9/5"-style score.
function reviewStats(reviews) {
  const count = reviews.length;
  const rated = reviews.filter(r => r.rating);
  const positive = reviews.filter(r => !r.rating || r.rating >= 4).length;
  const avg = rated.length ? Math.round(rated.reduce((s, r) => s + r.rating, 0) / rated.length * 10) / 10 : null;
  return {
    count,
    recommendationCount: count - rated.length,
    ratedCount: rated.length,
    verifiedCount: reviews.filter(r => r.verified).length,
    recommendPct: count ? Math.round(positive / count * 100) : 0,
    avgRating: avg,
  };
}

// One wording for the homepage link and the page: "9 recommendations",
// "15 reviews", or "24 reviews & recommendations". Never hard-coded.
function countLabel(s) {
  const n = s.count;
  if (n && s.ratedCount === 0) return `${n} recommendation${n === 1 ? '' : 's'}`;
  if (n && s.recommendationCount === 0) return `${n} review${n === 1 ? '' : 's'}`;
  return `${n} reviews & recommendations`;
}

module.exports = {
  fetchReviews, renderReviewCard, homepageReviews, reviewStats, countLabel,
  photoUrl, sourceLabel, originLabel, SOURCE_LABEL,
};
