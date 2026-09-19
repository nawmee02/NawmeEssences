-- ============================================================
--  ONE-OFF SEED — not a migration. Run AFTER 013_reviews.sql.
--  The 9 Facebook recommendations recovered from
--  facebook.com/NawmeEssences/reviews on 2026-09-19. Facebook counts
--  10; the 10th never renders and is NOT here — add it in Admin.
--
--  Every row is a Facebook "recommends" (rating NULL — the site shows
--  "Recommends NawmeEssences", never stars). verified stays false for
--  the owner to tick. Dates marked ≈ in the plan came from Facebook's
--  relative "Nw" labels. Body text is verbatim apart from minor
--  capitalisation/spacing fixes.
--
--  Re-runnable: ON CONFLICT on the partial unique index over source_url
--  (013) means a second run inserts nothing and never clobbers edits.
-- ============================================================

BEGIN;

INSERT INTO reviews (display_name, body, rating, source, source_url, product_name, reviewed_at, lang, verified, home_slot, status)
VALUES
  ('Md Jahid Hasan',
   'Consistently authentic products and outstanding customer service. I''ve been purchasing perfumes from them for quite a long time, and every experience has been excellent. One of the most reliable decant sellers in Bangladesh.',
   NULL, 'facebook',
   'https://www.facebook.com/md.jahid.hasan.534216/posts/pfbid022GTnCtKnGABSkyAUALtyAA7yKrXftokqbmPsepchpf5umjanSFqGCARnkEEEzfVHl',
   NULL, DATE '2026-08-01', 'en', false, 1, 'published'),

  ('Asif Akbar Zishan',
   'Amazing decant quality. 100% authentic, well packed. Delivery was fast and the seller was very responsive. Highly recommended.',
   NULL, 'facebook',
   'https://www.facebook.com/asifakbar.zishan.3/posts/pfbid0E2bC7CwN8UwWA77f8vFhYPDHH5y2Rhr4BGzq63S1CtGRwJ8MfepsZBqQqRiNJkJml',
   NULL, DATE '2026-02-14', 'en', false, 2, 'published'),

  ('Syed Omran Ahmed Pranto',
   'The seller sells authentic perfumes. You can buy it from them without any hesitation. Perfect packaging with perfect product. Highly Recommended',
   NULL, 'facebook',
   'https://www.facebook.com/sayed.omran.305/posts/pfbid0KVxLYACRySn89PG8H1DAGYhDZPTEJLc6ynmUW5XrUtfSbSqCkX3PLhszKoPm3e6wl',
   NULL, DATE '2025-07-05', 'en', false, 3, 'published'),

  ('Shariar Shojib',
   'My experience shopping here was fantastic. Wonderful packaging and excellent service, will definitely shop here again.',
   NULL, 'facebook',
   'https://www.facebook.com/shariar.shojib.383933/posts/pfbid02VVCoTtQtcTomZSTSAaYSmpXw6tyE7chVgUcJGiQK3g6YXmHR368cynqNTs6puwSSl',
   NULL, DATE '2025-09-19', 'en', false, NULL, 'published'),

  ('Rashedul Islam Jubayer',
   'বেশ কয়েকবার এই পেজ থেকে প্রোডাক্ট নিয়েছি। যেমন প্রত্যাশা করেছি ঠিক ওইরকম ই পেয়েছি পারফিউম। ধন্যবাদ সেলার কে।',
   NULL, 'facebook',
   'https://www.facebook.com/jubs8523/posts/pfbid0n1JgH7brdZWfKLyH1hAzNxLy4k4uhqB6bsiZHQdHkQ7Kxy4hYCdcEB7XcbRvZRyjl',
   NULL, DATE '2025-08-17', 'bn', false, NULL, 'published'),

  ('Iftear Hossen Pranto',
   'Alhamdulillah. 3ta decant nisi, onek bhalo performance paisi. Longevity onek bhalo. 1. Armaf Club De Nuit Intense For Men 2. Afnan Supremacy Not Only Intense 3. Hawas For Him',
   NULL, 'facebook',
   'https://www.facebook.com/iftearhossen.pranto.5/posts/pfbid0GqrmxxdLCueUH9cv8tbV22FTZmui9zdem2Ug2PguhBysgMZUBc57u8qnkSBiV3fel',
   'Armaf CDNI · Afnan Supremacy NOI · Rasasi Hawas', DATE '2026-04-04', 'en', false, NULL, 'published'),

  ('Fozlay Rabby Shuborno',
   'Good service and also a good fellow. Recommended for purchasing authentic decants.',
   NULL, 'facebook',
   'https://www.facebook.com/FR.Shuborno.07/posts/pfbid0qoFjFHdxNHE4nTXesVgzFiukySSrwyxfJuFWaSJiDsidFd4BoyDyLFSQgLjbx7Ljl',
   NULL, DATE '2026-02-21', 'en', false, NULL, 'published'),

  ('Tanjim',
   'Trusted and original, wishing success.',
   NULL, 'facebook',
   'https://www.facebook.com/74nj1m/posts/pfbid02RUNKKoKPL8BPeswKrYbvcQaXHFtL5yq6guH1SQ3rkSUFKwXTZ7SYA2dh8epsaV7il',
   NULL, DATE '2026-08-09', 'en', false, NULL, 'published'),

  ('Arif Hossen Rony',
   'Highly recommended .. Trustworthy and reliable!',
   NULL, 'facebook',
   'https://www.facebook.com/arnob.rony/posts/pfbid02LcpotZFVqM8nSSTvvjMuo9mfiRxNNszgbqqaNcAuyeEi8HGJ7edkJzrAWk8bSgA9l',
   NULL, DATE '2025-03-02', 'en', false, NULL, 'published')
ON CONFLICT (source_url) WHERE source_url IS NOT NULL DO NOTHING;

-- Verify: expect 9 published rows and home_slot 1,2,3 each used once.
SELECT count(*) AS published FROM reviews WHERE status = 'published';
SELECT home_slot, display_name FROM reviews WHERE home_slot IS NOT NULL ORDER BY home_slot;

COMMIT;
