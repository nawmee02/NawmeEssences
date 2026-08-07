-- ============================================================
--  NawmeEssences — add editable "homeSections" (How-to-Order +
--  FAQ) to the existing site_settings row, so the admin loads
--  the current homepage copy instead of blanks.
--  Run in Supabase Dashboard → SQL Editor (re-runnable, safe).
--  Depends on 007_site_settings.sql.
-- ============================================================

-- Only patch when the key is missing, so re-running never clobbers edits.
UPDATE site_settings
SET data = data || '{
  "homeSections": {
    "howToOrder": [
      { "title": "Choose Your Fragrance", "text": "Select your favorite fragrance and preferred size (3ml–30ml)." },
      { "title": "Place Your Order", "text": "Add items to your cart and complete checkout with your contact and delivery details." },
      { "title": "Confirm with Advance", "text": "Pay the required advance via bKash, Nagad, or Bank Transfer." },
      { "title": "Receive or Collect", "text": "Enjoy nationwide delivery or collect your order from Aftabnagar, Banasree, or NSU." }
    ],
    "faq": [
      { "q": "What is a perfume decant?", "a": "A perfume decant is a smaller quantity of fragrance transferred from an authentic original bottle into a travel-sized atomizer." },
      { "q": "Are your perfumes authentic?", "a": "Yes. Every decant is taken directly from authentic original bottles. We never dilute, mix, or alter the fragrance." },
      { "q": "Why buy a decant instead of a full bottle?", "a": "Decants let you experience premium fragrances at a lower cost before investing in a full-size bottle." },
      { "q": "What sizes do you offer?", "a": "We offer 3ml, 5ml, 10ml, 15ml, and selected fragrances in 30ml." },
      { "q": "How are decants measured?", "a": "We use sterile syringes to ensure accurate volume and maintain the fragrance''s quality." },
      { "q": "How long does delivery take?", "a": "Orders are typically delivered within 1–2 business days in Dhaka and 2–3 business days outside Dhaka." },
      { "q": "Can I return or exchange my order?", "a": "Opened or used decants cannot be returned. If you receive a damaged, missing, or incorrect item, contact us within 24 hours with a continuous unboxing video." },
      { "q": "Where can I collect my order?", "a": "Self-pickup is available from Aftabnagar, Banasree, and NSU by prior arrangement." },
      { "q": "How can I contact you?", "a": "The fastest way is through WhatsApp. You can also reach us via Messenger or Facebook." }
    ]
  }
}'::jsonb
WHERE id = 1 AND NOT (data ? 'homeSections');
