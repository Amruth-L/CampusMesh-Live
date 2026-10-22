/**
 * Reusable Razorpay Payment Service helper
 */

export const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const timeout = setTimeout(() => {
      resolve(false);
    }, 6000); // 6 second safety timeout
    
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    script.onerror = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    document.body.appendChild(script);
  });
};

export const openRazorpayCheckout = async ({
  key,
  amount,
  currency = 'INR',
  name = 'CampusMesh',
  description,
  order_id,
  prefill = {},
  handler,
  modalDismissHandler
}) => {
  if (!/^rzp_(test|live)_/.test(key || '') || !/^order_/.test(order_id || '')) throw new Error('Payment configuration is unavailable. No payment was taken.');
  const isLoaded = await loadRazorpayScript();
  if (!isLoaded) {
    throw new Error('Razorpay SDK failed to load. Please check your internet connection.');
  }

  // Always use a valid Razorpay key — never pass simulation placeholders to the SDK
  const resolvedKey = key;

  const options = {
    key: resolvedKey,
    amount: Math.round(parseFloat(amount) * 100), // convert to paise
    currency,
    name: name || 'CampusMesh',
    description: description || 'CampusMesh Student Rentals',
    image: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
    prefill: {
      name: prefill.name || '',
      email: prefill.email || '',
      contact: prefill.contact || prefill.phone_number || ''
    },
    theme: {
      color: '#10b981' // CampusMesh Emerald Green theme
    },
    handler: (response) => {
      // Signature is returned here on success
      if (handler) {
        handler({
          gateway_order_id: response.razorpay_order_id,
          gateway_payment_id: response.razorpay_payment_id,
          gateway_signature: response.razorpay_signature
        });
      }
    },
    modal: {
      ondismiss: () => {
        if (modalDismissHandler) {
          modalDismissHandler();
        }
      }
    }
  };

  // Make the mock-bank success flow easy to find in the student demo.
  // Live checkout keeps the merchant's normal payment-method configuration.
  if (resolvedKey.startsWith('rzp_test_')) {
    options.config = { display: {
      blocks: { testbank: { name: 'Test payment — choose Success at the bank', instruments: [{ method: 'netbanking' }] } },
      sequence: ['block.testbank'], preferences: { show_default_blocks: true },
    } };
  }

  // Only pass order_id if it's a real Razorpay order (not a simulated one)
  if (order_id && !order_id.startsWith('sim_')) {
    options.order_id = order_id;
  }

  const rzp = new window.Razorpay(options);

  // Capture payment failures and surface them
  rzp.on('payment.failed', (response) => {
    console.error('[Razorpay] Payment failed:', response.error);
    if (modalDismissHandler) {
      modalDismissHandler(response.error);
    }
  });

  rzp.open();
};
