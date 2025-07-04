const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const Move = require('../models/moveModel');

// Stripe requires the raw body to validate the signature
router.post('/', express.raw({type: 'application/json'}), async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_KEY);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const moveId = session.metadata.moveId;
    await Move.findByIdAndUpdate(moveId, { 'payment.status': 'completed', 'payment.transactionId': session.payment_intent });
  
  }

  res.json({received: true});
});

module.exports = router; 