require('dotenv').config();
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize SQLite database
const db = new sqlite3.Database('./payments.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        db.run(`CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT,
            phone TEXT,
            street TEXT,
            city TEXT,
            county TEXT,
            postal TEXT,
            mpesaNumber TEXT,
            reference TEXT,
            amount DECIMAL(10,2),
            status TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

// Daraja Credentials
// These will automatically pull from Vercel's Environment Variables when deployed,
// but fall back to the strings below for your local computer testing.
const consumerKey = process.env.DARAJA_CONSUMER_KEY || 'AxLj1Gt7TKrkhKn2vtppu9T4DLugjVjqhA9CMuivVfTDRozu';
const consumerSecret = process.env.DARAJA_CONSUMER_SECRET || 'BI1NYT5moUa8GdZJrUxVtfm2clYEuEjNw22fPwtT5PCN7Ke89ol4sRrYlpeqa5BW';
const passkey = process.env.DARAJA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const shortcode = process.env.DARAJA_SHORTCODE || '174379';

// Placeholder Callback URL
// On Vercel, set the environment variable DARAJA_CALLBACK_URL to https://your-app-domain.vercel.app/api/callback
const callbackURL = process.env.DARAJA_CALLBACK_URL || 'https://mydomain.com/api/callback';

// Middleware to get the Daraja Access Token
const generateToken = async (req, res, next) => {
    try {
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const response = await axios.get(
            'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            { headers: { authorization: `Basic ${auth}` } }
        );
        req.safaricom_access_token = response.data.access_token;
        next();
    } catch (error) {
        console.error("Access Token Error:", error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to generate Safaricom access token' });
    }
};

// Utility to format phone string to Daraja format (2547...)
const formatPhoneNumber = (phone) => {
    let p = phone.replace(/[^0-9]/g, '');
    if (p.startsWith('0')) p = '254' + p.substring(1);
    if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
    if (p.startsWith('+254')) p = p.substring(1);
    return p;
};

// Daraja STK Push Endpoint
app.post('/api/pay', generateToken, async (req, res) => {
    const { name, email, phone, street, city, county, postal, mpesaNumber } = req.body;
    
    if (!name || !mpesaNumber) {
        return res.status(400).json({ error: 'Name and M-Pesa number are required' });
    }

    const amount = '1'; // Use 1 KES for testing limits in sandbox
    const formattedPhone = formatPhoneNumber(mpesaNumber);
    const date = new Date();
    
    const timestamp = date.getFullYear() +
        ("0" + (date.getMonth() + 1)).slice(-2) +
        ("0" + date.getDate()).slice(-2) +
        ("0" + date.getHours()).slice(-2) +
        ("0" + date.getMinutes()).slice(-2) +
        ("0" + date.getSeconds()).slice(-2);

    const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');

    try {
        console.log(`Initiating STK Push to ${formattedPhone}...`);
        const response = await axios.post(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            {
                BusinessShortCode: shortcode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: 'CustomerPayBillOnline',
                Amount: amount,
                PartyA: formattedPhone,
                PartyB: shortcode,
                PhoneNumber: formattedPhone,
                CallBackURL: callbackURL,
                AccountReference: 'SwiftParcel',
                TransactionDesc: 'Delivery Payment'
            },
            {
                headers: { Authorization: `Bearer ${req.safaricom_access_token}` }
            }
        );

        const checkoutRequestId = response.data.CheckoutRequestID;
        console.log(`STK Push Request ID: ${checkoutRequestId}`);
        
        // Save initial pending state to SQLite
        db.run(
            `INSERT INTO payments (name, email, phone, street, city, county, postal, mpesaNumber, reference, amount, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, email, phone, street, city, county, postal, mpesaNumber, checkoutRequestId, amount, 'Pending'],
            function(err) {
                if (err) console.error("Database insert error:", err.message);
                
                res.json({
                    success: true,
                    checkoutRequestId: checkoutRequestId,
                    message: "STK Push sent successfully."
                });
            }
        );

    } catch (error) {
        console.error("STK Push error details:", error.response?.data || error.message);
        res.status(500).json({ error: 'STK Push failed from Safaricom' });
    }
});

// Safaricom Webhook Callback Endpoint
app.post('/api/callback', (req, res) => {
    console.log('\n--- SARAJA CALLBACK RECEIVED ---');
    console.log(JSON.stringify(req.body, null, 2));

    try {
        const body = req.body.Body.stkCallback;
        const checkoutRequestId = body.CheckoutRequestID;
        const resultCode = body.ResultCode;

        if (resultCode === 0) {
            // Payment successful
            const metadata = body.CallbackMetadata.Item;
            const receiptNumber = metadata.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
            
            db.run(
                `UPDATE payments SET status = ?, reference = ? WHERE reference = ?`,
                ['Completed', receiptNumber, checkoutRequestId],
                (err) => {
                    if (err) console.error("Database callback update error:", err.message);
                    else console.log(`Payment updated successfully. Receipt: ${receiptNumber}`);
                }
            );
        } else {
            // Payment failed (user cancelled, insufficient funds, etc.)
            const reason = body.ResultDesc;
            db.run(
                `UPDATE payments SET status = ? WHERE reference = ?`,
                ['Failed: ' + reason, checkoutRequestId],
                (err) => {
                    if (err) console.error("Database callback update error:", err.message);
                    else console.log(`Payment marked failed. Reason: ${reason}`);
                }
            );
        }
    } catch(err) {
        console.error("Error parsing callback payload:", err);
    }
    
    // Always respond 200 to Safaricom
    res.json({ ResultCode: 0, ResultDesc: "Success" });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
