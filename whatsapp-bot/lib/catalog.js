/* Service packages, pricing, and sample-photo catalog.
   Sent to customers on WhatsApp during the conversation.

   PHOTOS: WhatsApp needs public HTTPS image URLs. They're served from your
   live website — set SITE_URL in .env (e.g. https://www.flowersnballoons.com).
   Use .jpg/.png (WhatsApp previews those reliably; avoid .webp).
   Swap the generic filenames below for real per-service photos when you have them. */
'use strict';

const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');

/* ---- packages per service ---- */
const PACKAGES = {
  // maxDiscount = how much the bot may drop on its own for that tier
  // (tighter on entry tiers, roomier on premium). Falls back to 0.15 if unset.
  birthday: [
    { name: 'Starter', price: 3000, maxDiscount: 0.08, includes: ['Balloon backdrop', 'Age/name cutout', 'Basic props', 'Setup & cleanup'] },
    { name: 'Premium', price: 6000, maxDiscount: 0.12, popular: true, includes: ['Themed backdrop', 'Balloon arch', 'Dessert-table decor', 'Fairy lights', 'Setup & cleanup'] },
    { name: 'Grand', price: 12000, maxDiscount: 0.18, includes: ['Custom theme', 'Balloon ceiling + arch', 'Flower accents', 'Photo booth', 'Welcome board', 'Setup & cleanup'] },
  ],
  wedding: [
    { name: 'Essential', price: 15000, maxDiscount: 0.08, includes: ['Stage backdrop', 'Fresh-flower accents', 'Entrance decor', 'Setup & cleanup'] },
    { name: 'Grand', price: 40000, maxDiscount: 0.12, popular: true, includes: ['Designer stage', 'Mandap decor', 'Fresh flowers', 'Entrance/gate', 'Table centrepieces', 'Lighting', 'Setup & cleanup'] },
    { name: 'Royal', price: 100000, maxDiscount: 0.18, includes: ['Full-venue theme', 'Premium florals', 'Mandap + stage', 'Photo booth', 'Walkway + ceiling', 'Custom lighting', 'Dedicated team'] },
  ],
  babyshower: [
    { name: 'Starter', price: 5000, maxDiscount: 0.08, includes: ['Themed backdrop', 'Balloon decor', 'Welcome board', 'Setup & cleanup'] },
    { name: 'Premium', price: 10000, maxDiscount: 0.12, popular: true, includes: ['Custom theme backdrop', 'Balloon arch', 'Dessert-table decor', 'Photo props', 'Fairy lights', 'Setup & cleanup'] },
    { name: 'Grand', price: 20000, maxDiscount: 0.18, includes: ['Designer theme', 'Flower + balloon decor', 'Photo booth', 'Welcome board', 'Ceiling decor', 'Setup & cleanup'] },
  ],
  corporate: [
    { name: 'Basic', price: 10000, maxDiscount: 0.08, includes: ['Stage/banner backdrop', 'Balloon or floral accents', 'Setup & cleanup'] },
    { name: 'Standard', price: 25000, maxDiscount: 0.12, popular: true, includes: ['Branded backdrop', 'Entrance decor', 'Stage + lighting', 'Table setups', 'Setup & cleanup'] },
    { name: 'Premium', price: 50000, maxDiscount: 0.18, includes: ['Full-venue branding', 'Premium stage + lighting', 'Photo/selfie zone', 'Floral + balloon', 'Dedicated coordinator'] },
  ],
};

/* ---- sample photos per service (filenames under <SITE_URL>/images/) ---- */
const GALLERY = {
  birthday:   [['event-decoration-1.jpg', 'Balloon backdrop setup'], ['event-decoration-2.jpg', 'Themed party decor'], ['event-activities.jpg', 'Fun add-ons']],
  wedding:    [['event-decoration-3.jpg', 'Stage & floral decor'], ['event-decoration-1.jpg', 'Entrance styling'], ['event-decoration-2.jpg', 'Table centrepieces']],
  babyshower: [['event-decoration-2.jpg', 'Themed backdrop'], ['event-decoration-1.jpg', 'Balloon & dessert table'], ['event-activities.jpg', 'Photo props']],
  corporate:  [['event-decoration-3.jpg', 'Branded stage'], ['event-decoration-1.jpg', 'Entrance & lounge'], ['event-activities.jpg', 'Engagement zone']],
};

function photoUrls(serviceKey, limit = 3) {
  if (!SITE_URL) return [];
  const list = GALLERY[serviceKey] || [];
  return list.slice(0, limit).map(([file, caption]) => ({
    url: `${SITE_URL}/images/${file}`,
    caption,
  }));
}

module.exports = { PACKAGES, GALLERY, photoUrls, hasPhotos: !!SITE_URL };
