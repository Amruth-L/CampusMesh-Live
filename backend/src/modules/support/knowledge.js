module.exports = [
  {
    id: 'rent',
    title: 'Rent an item',
    keywords: ['rent', 'borrow', 'book', 'booking', 'dates', 'buy', 'purchase'],
    answer:
      'Browse Rent, open an item and choose your dates. Review rent, deposit and any delivery charge before checkout. CampusMesh currently offers rentals, not purchases. An owner must accept the request before the deposit and handover stages.',
    url: '/marketplace',
  },
  {
    id: 'payment',
    title: 'Payments and refunds',
    keywords: ['payment', 'paid', 'pay', 'charged', 'money', 'refund', 'deposit', 'failed', 'razorpay'],
    answer:
      'Check the payment status in your rental details before paying again. Wish Box has a Check payment button for interrupted checkout. A refund is confirmed only when your account record shows it; return inspection may be required. I cannot issue refunds or promise a refund date. If a charge is missing, create a support request with the booking reference, without card details or OTPs.',
    url: '/account/rentals',
  },
  {
    id: 'return',
    title: 'Due dates and returns',
    keywords: ['due', 'return', 'late', 'overdue', 'extend', 'extension', 'deadline', 'remind'],
    answer:
      'Open My rentals to see the agreed end date and start a return. If you need longer, request an extension there; it takes effect only after approval. Complete the return handover with the owner or assigned courier. Voice reminders are optional and can be changed in Reminder settings.',
    url: '/account/rentals',
  },
  {
    id: 'delivery',
    title: 'Route matching and delivery',
    keywords: ['delivery', 'deliver', 'courier', 'route', 'assign', 'eta', 'time', 'tracking', 'pending'],
    answer:
      'Campus deliveries are offered to available students whose route overlaps the pickup-to-drop journey, within their detour and time limits. A student accepts the offer before assignment. One active task is allowed at a time. ETAs are estimates; when there is not enough completed-trip history, they use the campus walking route.',
    url: '/delivery',
  },
  {
    id: 'wish',
    title: 'Wish Box',
    keywords: ['wish', 'errand', 'outside', 'shop', 'quote', 'price', 'medicine'],
    answer:
      'Write exactly what you need in Wish Box. A student takes the request, checks the shop and sends one total price. You can decline it or agree and pay. Collection unlocks after payment is confirmed. Give the student your delivery code only after receiving the correct item. Unconfirmed shop checks and quotes expire after 30 minutes.',
    url: '/wish-box',
  },
  {
    id: 'otp',
    title: 'Verification and handover codes',
    keywords: ['otp', 'code', 'login', 'password', 'sign', 'verification', 'email', 'qr'],
    answer:
      'Account verification codes and delivery handover codes are different. Use the account code only in the sign-in or verification screen. Share a handover OTP only with your assigned courier when both of you and the item are present. Never send passwords, account OTPs, payment PINs or card details to this assistant.',
    url: '/account/settings',
  },
  {
    id: 'print',
    title: 'Campus Print',
    keywords: ['print', 'xerox', 'pdf', 'printing'],
    answer: 'Campus Print is coming soon. Uploads and new print orders are currently locked.',
    url: '/print',
  },
  {
    id: 'trust',
    title: 'Return reliability',
    keywords: ['trust', 'score', 'rating', 'reliable', 'reliability', 'prediction'],
    answer:
      'Return reliability uses completed, paid non-demo rentals and whether they were returned by the agreed end date. It needs at least five completed rentals. New users are shown as Building history. The estimate is advisory, uses no demographic information, and does not automatically approve or reject anyone.',
    url: '/insights',
  },
  {
    id: 'calls',
    title: 'Automated call preferences',
    keywords: ['call', 'phone', 'voice', 'alert', 'stop', 'unsubscribe', 'marketing', 'promotion'],
    answer:
      'Due-date calls and recommendation calls have separate opt-ins under Reminder settings. You can turn either off at any time, or press 9 during a call to stop automated calls. Live calling requires a verified phone number. Calls are limited to 9 am–7 pm India time, at most one automated call per day, and one recommendation call per week. Preview mode never calls a phone.',
    url: '/reminders',
  },
  {
    id: 'recommendations',
    title: 'Recommendations and demand',
    keywords: ['recommend', 'trending', 'trend', 'popular', 'demand', 'forecast', 'hype', 'suggest'],
    answer:
      'Suggestions use recent unique views, saves, paid rentals and the categories you explored. Demo items are labelled as examples and do not count toward demand forecasts. Forecasts describe activity within CampusMesh, not the wider market, and show when there is too little history.',
    url: '/insights',
  },
  {
    id: 'support',
    title: 'Contact support',
    keywords: [
      'help',
      'support',
      'human',
      'complaint',
      'dispute',
      'broken',
      'damage',
      'wrong',
      'missing',
      'issue',
    ],
    answer:
      'I can explain CampusMesh flows and show your own booking status. For a dispute, damage or an unresolved charge, create a support request below. It is saved in CampusMesh; I cannot promise when a person will respond or claim that an issue has been resolved.',
    url: '/support',
  },
];
