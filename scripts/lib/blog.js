// ============================================================
//  blog.js — build-side helpers for the blog. Fetches published
//  posts from Supabase and renders their Markdown body to HTML.
//  Cover image URLs reuse catalog.publicUrl under a blog/ prefix.
// ============================================================
const { marked } = require('marked');

marked.setOptions({ gfm: true, breaks: false });

// Render a post's Markdown body to HTML. Content is authored only by admins
// (RLS-protected), so it is trusted; sanitization is noted as future hardening.
function renderMarkdown(md) {
  return marked.parse(String(md || ''));
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
      title:           p.title,
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
