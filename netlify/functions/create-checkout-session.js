// netlify/functions/create-checkout-session.js
//
// WHAT THIS FILE DOES
// --------------------
// index.html's "Checkout Full Cart" button POSTs the customer's cart here.
// This function creates the REAL Stripe Checkout Session (using your secret
// key, which is safe here because this code runs on Netlify's servers, never
// in the customer's browser) and hands back a URL. index.html then sends the
// browser to that URL, where Stripe securely collects payment.
//
// Netlify automatically finds and deploys any file in netlify/functions/ —
// there's nothing to configure beyond what's in the SETUP section below.
// You should not need to edit this file when adding new products; product
// info always comes from index.html at checkout time.
//
// SETUP (one-time):
// 1. Keep this file at: netlify/functions/create-checkout-session.js
// 2. Make sure package.json (next to this folder) lists "stripe" as a
//    dependency — Netlify installs it automatically on deploy.
// 3. In the Netlify dashboard: Site settings -> Environment variables, add:
//      STRIPE_SECRET_KEY = sk_live_...   (from Stripe Dashboard — the SECRET
//      key, never the pk_live_... publishable one used elsewhere)
// 4. Push/deploy. That's it — no other config needed for most Netlify sites.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const order = JSON.parse(event.body);

    if (!order.items || !order.items.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty.' }) };
    }

    // Build one Stripe line item per cart line. We use `price_data` (a
    // price defined on the fly) instead of a saved Stripe Price ID, because
    // the price already includes any $5 custom-order fee, and the exact
    // color/customization text needs to travel with THIS specific order —
    // not with a reusable catalog price.
    const line_items = order.items.map(item => {
      const label = [item.name];
      if (item.color) label.push(item.color);
      if (item.pompom === true) label.push('With Pom-Pom');
      if (item.pompom === false) label.push('No Pom-Pom');
      if (item.custom_requested) label.push('Custom Order');

      return {
        price_data: {
          currency: 'usd',
          product_data: {
            name: label.join(' — '),
            // Stored on the Stripe product for this line item so it shows up
            // in the Dashboard/exports even without opening session metadata.
            metadata: {
              color: item.color || '',
              pompom: item.pompom === null || item.pompom === undefined ? 'n/a' : String(item.pompom),
              custom_text: item.custom_text || '',
              custom_fee: String(item.custom_fee || 0)
            }
          },
          unit_amount: Math.round(item.unit_price * 100) // Stripe wants cents
        },
        quantity: item.qty
      };
    });

    // Flat-rate shipping as its own line item. Local pickup/delivery is $0,
    // so we simply don't add a shipping line for that case.
    // TO CHANGE THE SHIPPING PRICE: update both this 600 (cents) and the
    // "$6.00 Flat Rate" text in index.html's delivery radio label.
    if (order.delivery_method !== 'local_pickup') {
      line_items.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'USPS Ground Advantage Shipping (Flat Rate)' },
          unit_amount: 600
        },
        quantity: 1
      });
    }

    const siteUrl = process.env.URL || 'https://your-site.netlify.app';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      customer_email: order.contact && order.contact.includes('@') ? order.contact : undefined,
      // "Ship to Me" orders collect the address on Stripe's own hosted page:
      shipping_address_collection: order.collect_shipping_address
        ? { allowed_countries: ['US'] }
        : undefined,
      // Requires Stripe Tax to be enabled on your account (Settings -> Tax),
      // with your nexus/registrations set up there. For "Ship to Me" orders,
      // Stripe calculates tax from the shipping address collected above; for
      // local pickup orders (no shipping address), it falls back to your
      // business's registered address.
      automatic_tax: { enabled: true },
      success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/`,
      // Local pickup orders pass Building/Apartment number here instead of a
      // shipping address, alongside contact info for reference:
      metadata: {
        contact: order.contact || '',
        delivery_method: order.delivery_method || 'ship',
        building_number: (order.pickup_details && order.pickup_details.building_number) || '',
        apartment_number: (order.pickup_details && order.pickup_details.apartment_number) || ''
      }
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
