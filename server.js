require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Stripe = require('stripe');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2025-01-27.acacia' }) : null;

app.get('/api/config', (req, res) => {
    res.json({ publishableKey: stripePublishableKey || '' });
});

// Create a PaymentIntent for card payments (Stripe Elements)
app.post('/api/create-payment-intent', async (req, res) => {
    try {
        if (!stripe) {
            return res.status(500).json({
                error: 'Card payments are not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY.'
            });
        }

        const { amountKsh } = req.body || {};
        const amount = Number(amountKsh);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amountKsh' });
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // KES uses 2 decimal places on Stripe
            currency: 'kes',
            automatic_payment_methods: { enabled: true },
            description: 'Posta Kenya delivery payment'
        });

        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        console.error('PaymentIntent error:', err);
        res.status(500).json({ error: 'Failed to create PaymentIntent' });
    }
});

// Export the Express app for Vercel Serverless Functions
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
module.exports = app;
