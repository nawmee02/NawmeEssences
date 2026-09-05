-- ============================================================
--  ONE-OFF DATA REPAIR — not a migration.
--  Restores fragrance notes/accords/family wiped by the admin
--  to-one embed bug (js/admin.js read fragrance_details[0] on
--  what PostgREST returns as an object, so the edit form loaded
--  blank and the save overwrote the real values with empties).
--
--  Source: js/products.js (the pre-Supabase catalog).
--  Deliberately does NOT touch description or occasions.
--  Guarded: only updates rows that are still empty, so it is
--  safe to re-run and will not clobber anything you re-entered.
-- ============================================================

BEGIN;

UPDATE fragrance_details SET
  top_notes   = '["Apple","Pineapple","Bergamot"]'::jsonb,
  heart_notes = '["Cinnamon","Lavender","Rose"]'::jsonb,
  base_notes  = '["Vanilla","Amber","Musk","Patchouli"]'::jsonb,
  accords     = '["Sweet","Spicy","Fruity","Woody"]'::jsonb,
  family      = 'Oriental / Spicy'
WHERE fragrance_id = 'afnan-9pm'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Green Leaves","Apple"]'::jsonb,
  heart_notes = '["Lotus","Mimosa"]'::jsonb,
  base_notes  = '["Musk","Cedar","Oakmoss","Amber"]'::jsonb,
  accords     = '["Aquatic","Fresh","Woody","Green"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'nautica-voyage'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Cinnamon","Cardamom","Ginger"]'::jsonb,
  heart_notes = '["Praline","Candied Fruits","White Flowers"]'::jsonb,
  base_notes  = '["Vanilla","Coffee","Tonka Bean","Benzoin","Musk"]'::jsonb,
  accords     = '["Oriental","Gourmand","Spicy","Sweet"]'::jsonb,
  family      = 'Gourmand'
WHERE fragrance_id = 'lattafa-khamrah-qahwa'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Ginger","Mandarin","Pink Pepper"]'::jsonb,
  heart_notes = '["Lavender","Praline","Cacao","Jasmine"]'::jsonb,
  base_notes  = '["Vanilla","Amber","Musk"]'::jsonb,
  accords     = '["Gourmand","Sweet","Vanilla","Floral"]'::jsonb,
  family      = 'Gourmand'
WHERE fragrance_id = 'lattafa-angham'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Grapefruit","Cypress"]'::jsonb,
  heart_notes = '["Vetiver"]'::jsonb,
  base_notes  = '["Woody Notes","Musk"]'::jsonb,
  accords     = '["Fresh","Woody","Citrus","Aromatic"]'::jsonb,
  family      = 'Woody'
WHERE fragrance_id = 'lalique-encre-noire-sport'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Bergamot","Pineapple","Grapefruit"]'::jsonb,
  heart_notes = '["Patchouli","Cedarwood","Jasmine"]'::jsonb,
  base_notes  = '["Oakmoss","Woody Notes","Amber"]'::jsonb,
  accords     = '["Fresh","Chypre","Woody","Citrus"]'::jsonb,
  family      = 'Woody'
WHERE fragrance_id = 'rasasi-hawas-black'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Mint","Bergamot","Artemisia"]'::jsonb,
  heart_notes = '["Dark Chocolate","Lavender","Benzoin"]'::jsonb,
  base_notes  = '["Vanilla","Tonka Bean","White Musk"]'::jsonb,
  accords     = '["Gourmand","Sweet","Minty","Oriental"]'::jsonb,
  family      = 'Gourmand'
WHERE fragrance_id = 'rasasi-hawas-elixir'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Apple","Bergamot","Lemon","Cinnamon"]'::jsonb,
  heart_notes = '["Watery Notes","Plum","Orange Blossom","Cardamom"]'::jsonb,
  base_notes  = '["Ambergris","Musk","Patchouli","Driftwood"]'::jsonb,
  accords     = '["Aquatic","Fresh","Fruity","Sweet"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'rasasi-hawas'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Bergamot","Saffron"]'::jsonb,
  heart_notes = '["Plum Liquor","Cinnamon"]'::jsonb,
  base_notes  = '["Tonka Bean","Amber","Benzoin"]'::jsonb,
  accords     = '["Oriental","Spicy","Boozy","Sweet"]'::jsonb,
  family      = 'Oriental / Spicy'
WHERE fragrance_id = 'lattafa-teriaq-intense'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Pineapple","Grapefruit","Apple","Lemon"]'::jsonb,
  heart_notes = '["Leather","Oud","Saffron","Raspberry"]'::jsonb,
  base_notes  = '["Patchouli","Amber","Moss","Caramel"]'::jsonb,
  accords     = '["Oriental","Fruity","Leather","Sweet"]'::jsonb,
  family      = 'Oriental / Spicy'
WHERE fragrance_id = 'rasasi-hawas-lava-gold'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Lime","Mint","Grapefruit","Lavender","Pineapple"]'::jsonb,
  heart_notes = '["Black Pepper","Rosemary","Juniper Berry","Geranium","Frankincense"]'::jsonb,
  base_notes  = '["Ambroxan","Vetiver","Oakmoss","Cashmeran","Tonka Bean"]'::jsonb,
  accords     = '["Fresh","Aromatic","Woody","Citrus"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'lattafa-maahir-legacy'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Bergamot","Ginger","Clary Sage","Raspberry","Nutmeg"]'::jsonb,
  heart_notes = '["Rooibos Tea","Suede"]'::jsonb,
  base_notes  = '["Cedarwood","Cashmeran","Amberwood"]'::jsonb,
  accords     = '["Spicy","Woody","Tea","Fresh"]'::jsonb,
  family      = 'Woody'
WHERE fragrance_id = 'lattafa-dynasty'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Apple","Italian Lemon","Sicilian Bergamot","Star Anise"]'::jsonb,
  heart_notes = '["Plum","Orange Blossom","Cardamom"]'::jsonb,
  base_notes  = '["Musk","Amber","Driftwood","Moss"]'::jsonb,
  accords     = '["Fresh","Fruity","Sweet","Aquatic"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'rasasi-hawas-ice'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Ginger","Bergamot","Tangerine"]'::jsonb,
  heart_notes = '["Cinnamon","Green Tea","Neroli"]'::jsonb,
  base_notes  = '["Musk","Woodsy Notes","Amber"]'::jsonb,
  accords     = '["Fresh","Aromatic","Tea","Citrus"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'rasasi-hawas-kobra'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Bergamot","Aldehydes","Marine"]'::jsonb,
  heart_notes = '["Iris","Rosewood","Vetiver"]'::jsonb,
  base_notes  = '["Ambroxan","Sandalwood","Musk"]'::jsonb,
  accords     = '["Aquatic","Woody","Fresh","Marine"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'prada-luna-rossa-ocean-edp'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Grapefruit","Bergamot","Lemon"]'::jsonb,
  heart_notes = '["Geranium","Sage","Lavender"]'::jsonb,
  base_notes  = '["Musk","Cedarwood","Oakmoss"]'::jsonb,
  accords     = '["Fresh","Aromatic","Citrus","Woody"]'::jsonb,
  family      = 'Aromatic'
WHERE fragrance_id = 'missoni-wave'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Bergamot","Lemon","Orange"]'::jsonb,
  heart_notes = '["Jasmine","Lavender","Sage"]'::jsonb,
  base_notes  = '["Sandalwood","Musk","Amber","Oakmoss"]'::jsonb,
  accords     = '["Aromatic","Fresh","Woody","Floral"]'::jsonb,
  family      = 'Aromatic'
WHERE fragrance_id = 'missoni-parfum-homme'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Lemon","Bergamot","Pepper"]'::jsonb,
  heart_notes = '["Labdanum","Oakmoss","Cyclamen"]'::jsonb,
  base_notes  = '["Vetiver","Musk","Amber","Cedar"]'::jsonb,
  accords     = '["Aromatic","Woody","Fresh","Dark"]'::jsonb,
  family      = 'Aromatic'
WHERE fragrance_id = 'mercedes-club-black'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Lemon","Bergamot","Lime"]'::jsonb,
  heart_notes = '["Jasmine","Rose","Galbanum"]'::jsonb,
  base_notes  = '["Musk","Ambergris","Cedar"]'::jsonb,
  accords     = '["Fresh","Citrus","Floral","Marine"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'mancera-french-riviera'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Bergamot","Black Pepper","Cardamom"]'::jsonb,
  heart_notes = '["Violet","Iris","Leather"]'::jsonb,
  base_notes  = '["Sandalwood","Amber","Musk","Tonka Bean"]'::jsonb,
  accords     = '["Spicy","Woody","Leather","Fresh"]'::jsonb,
  family      = 'Woody'
WHERE fragrance_id = 'mancera-instant-crush'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Lemon","Ginger","Mandarin"]'::jsonb,
  heart_notes = '["Violet","Rose","Amber"]'::jsonb,
  base_notes  = '["Ambroxan","Sandalwood","Patchouli","Oud"]'::jsonb,
  accords     = '["Spicy","Woody","Citrus","Aromatic"]'::jsonb,
  family      = 'Woody'
WHERE fragrance_id = 'rasasi-shuhrah-elixir'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Coconut Water","Fig Leaf","Ginger"]'::jsonb,
  heart_notes = '["Coconut","Fig","Mint"]'::jsonb,
  base_notes  = '["Sandalwood","Tonka Bean","Musk"]'::jsonb,
  accords     = '["Tropical","Coconut","Green","Fresh"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'rasasi-hawas-tropical'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Bergamot","Ginger","Apple"]'::jsonb,
  heart_notes = '["Spicy Notes"]'::jsonb,
  base_notes  = '["Woody Notes","Amber"]'::jsonb,
  accords     = '["Fresh","Spicy","Woody","Aromatic"]'::jsonb,
  family      = 'Aromatic'
WHERE fragrance_id = 'rasasi-hawas-thunder'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Pineapple","Orange","Grapefruit"]'::jsonb,
  heart_notes = '["Amber","Orris","Lavender"]'::jsonb,
  base_notes  = '["Tonka Bean","Musk","Cashmeran","Patchouli"]'::jsonb,
  accords     = '["Tropical","Fruity","Floral","Sweet"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'rasasi-hawas-malibu'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Cardamom","Pepper"]'::jsonb,
  heart_notes = '["Bergamot","Lavender","Geranium"]'::jsonb,
  base_notes  = '["Cedarwood","Vetiver","Tonka Bean"]'::jsonb,
  accords     = '["Aromatic","Spicy","Woody","Fresh"]'::jsonb,
  family      = 'Aromatic'
WHERE fragrance_id = 'riiffs-fareed'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Cardamom","Elemi","Lemon","Bergamot","Sichuan Pepper"]'::jsonb,
  heart_notes = '["Patchouli","Coriander","Cumin","Anise","Saffron","Orange Blossom","Rose","Geranium"]'::jsonb,
  base_notes  = '["Frankincense","Amber","Vanilla","Benzoin","Oud","Musk","Labdanum","Ambergris"]'::jsonb,
  accords     = '["Spicy","Oriental","Woody","Resinous"]'::jsonb,
  family      = 'Oriental / Spicy'
WHERE fragrance_id = 'rayhaan-terra'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Lime","Coconut Milk","Bergamot","Mandarin"]'::jsonb,
  heart_notes = '["Sugar Cane","Jasmine","Hibiscus","Gardenia"]'::jsonb,
  base_notes  = '["Rum","Musk","Tonka Bean","Patchouli"]'::jsonb,
  accords     = '["Aquatic","Tropical","Citrus","Gourmand"]'::jsonb,
  family      = 'Aquatic / Fresh'
WHERE fragrance_id = 'rayhaan-aquatica'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Bergamot","Ginger","Sage"]'::jsonb,
  heart_notes = '["Geranium","Cedar"]'::jsonb,
  base_notes  = '["Tonka Bean","Musk","Amber"]'::jsonb,
  accords     = '["Woody","Fresh","Aromatic","Spicy"]'::jsonb,
  family      = 'Woody'
WHERE fragrance_id = 'ysl-y-edp'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

UPDATE fragrance_details SET
  top_notes   = '["Lavender","Pear","Mint","Bergamot"]'::jsonb,
  heart_notes = '["Cinnamon","Clary Sage","Cumin"]'::jsonb,
  base_notes  = '["Vanilla","Amber","Cedar","Patchouli"]'::jsonb,
  accords     = '["Spicy","Sweet","Aromatic","Woody"]'::jsonb,
  family      = 'Oriental / Spicy'
WHERE fragrance_id = 'rayhaan-lion'
  AND accords = '[]'::jsonb AND coalesce(family,'') = '';

-- Verify: this should list ONLY the 9 products that have no source in
-- js/products.js (added to Supabase later). Any other id here means a
-- repair statement did not apply.
SELECT fragrance_id FROM fragrance_details
WHERE accords = '[]'::jsonb AND coalesce(family,'') = '' ORDER BY fragrance_id;

COMMIT;
