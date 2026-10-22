/**
 * CampusMesh FinTech Dynamic Pricing Engine
 * Performs server-side calculations for Rental Fee, Delivery Fee, Platform Fee,
 * Suggested Security Deposit, and Total Booking Amounts.
 */

/**
 * Step 1: Calculate Rental Fee
 * Rental Fee = Daily Rent × Rental Days
 */
function calculateRentalFee(dailyRent, days) {
  const rent = parseFloat(dailyRent) || 0;
  const numDays = Math.max(1, parseInt(days, 10) || 1);
  return Number((rent * numDays).toFixed(2));
}

/**
 * Step 2: Calculate Distance, Delivery Fee, and Estimated Delivery Time
 * Rules:
 * - Self Pickup: ₹0, 0 km, 'Self Pickup'
 * - Same Hostel: ₹2, 0.2 km, '5 mins'
 * - ≤ 1 km: ₹5, '10 mins'
 * - 1–3 km: ₹10, '15 mins'
 * - 3–5 km: ₹15, '20 mins'
 * - > 5 km: ₹15 + ₹2 for every extra km, '25 mins + ...'
 */
function calculateDelivery(deliveryType, ownerLocation = '', renterLocation = '', distanceOverride = null) {
  if (!deliveryType || deliveryType === 'SELF_PICKUP' || deliveryType === 'NONE' || deliveryType === false) {
    return {
      deliveryFee: 0.00,
      distance: 0.0,
      estimatedTime: 'Self Pickup'
    };
  }

  // Same Hostel check
  const locA = (ownerLocation || '').trim().toLowerCase();
  const locB = (renterLocation || '').trim().toLowerCase();
  const isSameHostel = (locA && locB && locA === locB) || locA.includes('hostel') && locB.includes('hostel') && locA === locB;

  if (isSameHostel) {
    return {
      deliveryFee: 2.00,
      distance: 0.2,
      estimatedTime: '5 mins'
    };
  }

  let distance = distanceOverride !== null ? parseFloat(distanceOverride) : 1.5; // Default campus distance
  if (isNaN(distance) || distance < 0) distance = 1.0;

  let deliveryFee = 0.00;
  let estimatedTime = '10 mins';

  if (distance <= 1.0) {
    deliveryFee = 5.00;
    estimatedTime = '10 mins';
  } else if (distance <= 3.0) {
    deliveryFee = 10.00;
    estimatedTime = '15 mins';
  } else if (distance <= 5.0) {
    deliveryFee = 15.00;
    estimatedTime = '20 mins';
  } else {
    const extraKm = Math.ceil(distance - 5.0);
    deliveryFee = 15.00 + (extraKm * 2.00);
    const extraMins = Math.round(extraKm * 4);
    estimatedTime = `${20 + extraMins} mins`;
  }

  return {
    deliveryFee: Number(deliveryFee.toFixed(2)),
    distance: Number(distance.toFixed(1)),
    estimatedTime
  };
}

/**
 * Step 3: Calculate Platform Fee
 * Platform Fee = 5% of Rental Fee
 * Minimum = ₹1.25
 * Maximum = ₹25.00
 */
function calculatePlatformFee(rentalFee) {
  const fee = rentalFee * 0.05;
  const clampedFee = Math.min(Math.max(fee, 1.25), 25.00);
  return Number(clampedFee.toFixed(2));
}

/**
 * Step 4: Calculate Security Deposit based on Item Market Value
 * Rules:
 * ₹0–₹500: 30%
 * ₹501–₹2000: 25%
 * ₹2001–₹10000: 20%
 * Above ₹10000: 15%
 */
function calculateSuggestedDeposit(itemValue, customDepositOverride = null) {
  if (customDepositOverride !== null && customDepositOverride !== undefined && !isNaN(parseFloat(customDepositOverride)) && parseFloat(customDepositOverride) > 0) {
    return Number(parseFloat(customDepositOverride).toFixed(2));
  }

  const val = parseFloat(itemValue) || 0;
  let percentage = 0.30;

  if (val <= 500) {
    percentage = 0.30;
  } else if (val <= 2000) {
    percentage = 0.25;
  } else if (val <= 10000) {
    percentage = 0.20;
  } else {
    percentage = 0.15;
  }

  return Number((val * percentage).toFixed(2));
}

/**
 * Master Function: Calculate Full Pricing Breakdown
 */
function calculatePricing({
  dailyRent,
  days,
  deliveryType,
  ownerLocation,
  renterLocation,
  distance,
  itemValue,
  customDeposit
}) {
  const rentalFee = calculateRentalFee(dailyRent, days);
  const delivery = calculateDelivery(deliveryType, ownerLocation, renterLocation, distance);
  const platformFee = calculatePlatformFee(rentalFee);
  const securityDeposit = calculateSuggestedDeposit(itemValue, customDeposit);
  const totalAmount = Number((rentalFee + delivery.deliveryFee + platformFee).toFixed(2));

  return {
    rentalFee,
    deliveryFee: delivery.deliveryFee,
    platformFee,
    securityDeposit,
    totalAmount,
    distance: delivery.distance,
    estimatedTime: delivery.estimatedTime
  };
}

module.exports = {
  calculateRentalFee,
  calculateDelivery,
  calculatePlatformFee,
  calculateSuggestedDeposit,
  calculatePricing
};

