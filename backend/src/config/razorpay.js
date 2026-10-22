const Razorpay = require('razorpay');
require('dotenv').config();

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

if (!key_id || !key_secret || key_id === 'your_razorpay_key_id') {
  console.warn('[Payment] Warning: Razorpay credentials are not fully configured in .env. Payment creation will remain unavailable.');
}

const razorpay = new Razorpay({
  key_id: key_id || 'dummy_key',
  key_secret: key_secret || 'dummy_secret'
});

module.exports = razorpay;

