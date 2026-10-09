-- The real packaging list, with the box each thing travels in.
--
-- Until now the catalog shipped seven made-up package types -- "Single-tier cake", "Flowers"
-- -- which were honest placeholders and are not what the business sells. These are the boxes
-- actually in use, with the dimensions and weights off the operator's own list, and the
-- categories the operator sorts them by.
--
-- Where the source list had the same box twice with different measurements, the larger of
-- each dimension and the heavier weight are taken, so nothing is under-declared. Where two
-- entries were plainly the same box under two names, they are one row here. Every value is
-- editable in Admin -> Pricing, which is where corrections belong.
--
-- The seven placeholders are left switched on. Turning one off is a click in the console and
-- the operator's call to make, and it is not free: a package type that is not active cannot
-- be resolved when an old quote is re-priced, so the moment to retire them is once this list
-- has been checked, not in a migration that cannot ask.
--
-- Data only, and idempotent: re-running changes nothing.

INSERT INTO "package_categories" ("name", "sort_order") VALUES
  ('Single Tier Cake', 1),
  ('2 Tier Cake', 2),
  ('3 Tier Cake', 3),
  ('Cupcakes', 4),
  ('Brownies', 5),
  ('Macarons', 6),
  ('Cheesecake', 7),
  ('Deli Cake', 8),
  ('Lunchbox Cake', 9),
  ('Cake Tasting', 10),
  ('Other', 11)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "package_types"
  ("code", "name", "category", "length_cm", "width_cm", "height_cm", "max_weight_kg", "sort_order")
VALUES
  ('box_cake_xsmall', 'Xsmall Cake Box', 'Single Tier Cake', 24, 26, 28, 1, 10),
  ('box_cake_small', 'Small Cake Box', 'Single Tier Cake', 25, 25, 45, 2, 11),
  ('box_cake_medium', 'Medium Cake Box', 'Single Tier Cake', 30, 30, 47, 3, 12),
  ('box_cake_8in', '8 inch Cake Box', 'Single Tier Cake', 20, 20, 15, 3, 13),
  ('box_cake_10in', '10 inch Cake Box', 'Single Tier Cake', 25, 25, 15, 4, 14),
  ('box_cake_12in', '12 inch Cake Box', 'Single Tier Cake', 30, 30, 15, 4, 15),
  ('box_cake_14in', '14 inch Cake Box', 'Single Tier Cake', 35, 35, 15, 5, 16),
  ('box_cake_16in', '16 inch Cake Box', 'Single Tier Cake', 40, 40, 15, 5, 17),
  ('box_cake_18in', '18 inch Cake Box', 'Single Tier Cake', 45, 45, 15, 5, 18),
  ('box_cake_20in', '20 inch Cake Box', 'Single Tier Cake', 50, 50, 15, 2, 19),
  ('box_white_small', 'Small White Cake Box', 'Single Tier Cake', 32, 26, 26, 5, 20),
  ('box_white_medium', 'Medium White Cake Box', 'Single Tier Cake', 32, 30, 33, 10, 21),
  ('box_tall_small', 'Small Tall Cake Box', 'Single Tier Cake', 28, 44, 26, 5, 22),
  ('box_tall_medium', 'Medium Tall Cake Box', 'Single Tier Cake', 32, 33, 46, 10, 23),
  ('box_wedding_small', 'Small Wedding Cake Box', '2 Tier Cake', 27, 27, 25, 5, 24),
  ('box_wedding_medium', 'Medium Wedding Cake Box', '2 Tier Cake', 37, 35, 40, 10, 25),
  ('box_wedding_large', 'Large Wedding Cake Box', '3 Tier Cake', 45, 45, 45, 18, 26),
  ('box_cake_3tier', '3-tier Cake Box', '3 Tier Cake', 35, 35, 45, 3, 27),
  ('box_cupcake_6', 'Cupcake Box of 6', 'Cupcakes', 25, 17, 10, 2, 28),
  ('box_cupcake_12', 'Cupcake Box of 12', 'Cupcakes', 35, 33, 10, 2, 29),
  ('box_bento_5', 'Bento Box with 5 Cupcakes', 'Cupcakes', 26, 26, 10, 1, 30),
  ('box_macaron', 'Macaron Box', 'Macarons', 23, 23, 5, 1, 31),
  ('box_cheesecake', 'Cheesecake Box', 'Cheesecake', 20, 20, 8, 2, 32),
  ('box_cheesecake_large', 'Large Cheesecake Box', 'Cheesecake', 25, 25, 10, 3, 33),
  ('box_deli', 'Deli Cake Box', 'Deli Cake', 23, 23, 15, 1, 34),
  ('box_lunchbox', 'Lunchbox Cake Box', 'Lunchbox Cake', 12, 12, 7, 1, 35),
  ('box_lunchie', 'Lunchie Box', 'Lunchbox Cake', 9, 15, 16, 1, 36),
  ('box_cake_tasting', 'Cake Tasting Box', 'Cake Tasting', 16, 12, 3, 1, 37),
  ('box_cookie_6', 'Cookie Box of 6', 'Other', 24, 16, 11, 2, 38),
  ('box_cookie_12', 'Cookie Box of 12', 'Other', 24, 24, 12, 4, 39),
  ('box_cookie_cake', 'Cookie Cake Box', 'Other', 24, 30, 12, 2, 40),
  ('box_platter_medium', 'Platters Medium', 'Other', 30, 30, 10, 3, 41),
  ('box_platter_large', 'Platters Large', 'Other', 35, 35, 10, 3, 42),
  ('box_flattery', 'Flattery Box', 'Other', 14, 34, 26, 8, 43),
  ('box_baton', 'Baton Box', 'Other', 57, 37, 15, 5, 44),
  ('box_custom_dessert', 'Custom Dessert Box', 'Other', 30, 30, 20, 20, 45),
  ('box_other', 'Other packaging', 'Other', 30, 30, 20, 5, 46)
ON CONFLICT ("code") DO NOTHING;
