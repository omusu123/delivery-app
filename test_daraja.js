const axios = require('axios');

const consumerKey = 'AxLj1Gt7TKrkhKn2vtppu9T4DLugjVjqhA9CMuivVfTDRozu';
const consumerSecret = 'BI1NYT5moUa8GdZJrUxVtfm2clYEuEjNw22fPwtT5PCN7Ke89ol4sRrYlpeqa5BW';

async function test() {
    console.log("Testing Daraja credentials...");
    try {
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const response = await axios.get(
            'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            { headers: { authorization: `Basic ${auth}` } }
        );
        console.log("SUCCESS! Token:", response.data.access_token);
    } catch (error) {
        console.log("ERROR!");
        console.log("Status:", error.response?.status);
        console.log("Data:", error.response?.data);
        console.log("Message:", error.message);
    }
}

test();
