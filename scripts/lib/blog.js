// ============================================================
//  blog.js — build-side helpers for the blog. Fetches published
//  posts from Supabase and renders their Markdown body to HTML.
//  Cover image URLs reuse catalog.publicUrl under a blog/ prefix.
// ============================================================
const { marked } = require('marked');

marked.setOptions({ gfm: true, breaks: false });

const headingSlug = text => String(text)
  .replace(/<[^>]*>/g, '')
  .replace(/&[a-z0-9#]+;/gi, '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9\s-]/g, '')
  .replace(/[\s-]+/g, '-') || 'section';

const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderToc(headings) {
  const sections = headings.filter(h => h.level >= 2);
  if (!sections.length) return '';
  return `<nav class="post-toc" aria-label="Table of contents"><strong>In this guide</strong><ol>${sections.map(h =>
    `<li class="post-toc-level-${h.level}"><a href="#${escapeAttr(h.id)}">${escapeAttr(h.label)}</a></li>`
  ).join('')}</ol></nav>`;
}

// Render a post's Markdown body. Headings receive stable IDs so
// author-written anchor links work, and [[toc]] expands to a generated TOC.
function renderMarkdown(md) {
  const headings = [];
  const usedIds = new Set();
  const renderer = new marked.Renderer();
  renderer.heading = (text, level) => {
    const base = headingSlug(text);
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    headings.push({ id, level, label: String(text).replace(/<[^>]*>/g, '') });
    return `<h${level} id="${escapeAttr(id)}">${text}</h${level}>\n`;
  };
  const html = marked.parse(String(md || ''), { renderer });
  return html.replace(/<p>\[\[toc\]\]<\/p>/i, renderToc(headings));
}

// Fetch published posts, newest first. Resilient: if the blog_posts table
// doesn't exist yet (migration 010 not run), return [] so the build still
// succeeds and simply produces no blog pages.
async function fetchPosts(sb) {
  try {
    const { data, error } = await sb
      .from('blog_posts')
      .select('id, title, excerpt, body_md, cover, meta_title, meta_description, published_at, updated_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false });
    if (error) {
      console.warn('  ⚠️  blog_posts not found — run migration 010. Building without a blog.');
      return [];
    }
    return (data || []).map(p => ({
      id:              p.id,
      // A title typed as "Post | NawmeEssences" in admin would otherwise show the
      // suffix in the H1, breadcrumb and cards; the <title> adds its own suffix.
      title:           String(p.title || '').replace(/\s*\|\s*NawmeEssences\s*$/i, '').trim(),
      excerpt:         p.excerpt || '',
      bodyMd:          p.body_md || '',
      cover:           !!p.cover,
      metaTitle:       p.meta_title || '',
      metaDescription: p.meta_description || '',
      publishedAt:     p.published_at || p.updated_at || null,
      updatedAt:       p.updated_at || null,
    }));
  } catch (e) {
    return [];
  }
}

module.exports = { fetchPosts, renderMarkdown };
