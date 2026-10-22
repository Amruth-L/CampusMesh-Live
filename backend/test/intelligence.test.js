const test = require('node:test');
const assert = require('node:assert/strict');
const { forecastDemand, trustEstimate, trainEta, predictEta } = require('../src/modules/intelligence/models');
const { scoreCandidate } = require('../src/modules/delivery/matching.service');
const {
  localTime,
  inCallWindow,
  reminderStage,
  scriptFor,
  createCallService,
} = require('../src/modules/calls/call.service');
const { retrieve, groundedFallback, redact, answer } = require('../src/modules/support/support.service');
test('demand forecasts abstain on sparse histories and respond to recent demand', () => {
  assert.equal(forecastDemand(Array(28).fill(0)).nextWeek, null);
  const flat = forecastDemand(Array(28).fill(2));
  assert.equal(flat.nextWeek, 14);
  const rising = forecastDemand([...Array(21).fill(1), ...Array(7).fill(4)]);
  assert(rising.nextWeek > flat.nextWeek);
  assert.equal(rising.trendPercent, 300);
  assert.equal(rising.observations, 49);
});
test('new users remain neutral; reliability is bounded and evidence based', () => {
  assert.equal(trustEstimate(0, 0).estimate, null);
  assert.equal(trustEstimate(4, 4).estimate, null);
  const t = trustEstimate(10, 9);
  assert.equal(t.estimate, 83);
  assert(t.range[0] < 90 && t.range[1] > 90);
  assert(trustEstimate(20, 20).estimate < 100);
});
test('ETA regression uses holdout accuracy and falls back outside its range', () => {
  assert.equal(trainEta([]).method, 'route_baseline');
  const rows = Array.from({ length: 40 }, (_, i) => ({
    meters: 100 + i * 40,
    minutes: 2 + (100 + i * 40) / 100,
  }));
  const model = trainEta(rows);
  assert.equal(model.method, 'validated_linear_regression');
  assert(model.mae < model.baselineMae);
  assert.equal(predictEta(500, model).minutes, 7);
  assert.equal(predictEta(4000, model).method, 'route_baseline');
  assert.equal(
    trainEta(Array.from({ length: 25 }, () => ({ meters: 500, minutes: 8 }))).method,
    'route_baseline',
  );
  assert.equal(predictEta(NaN), null);
});
test('route matching does not count reverse-direction overlap', () => {
  assert.equal(
    scoreCandidate(
      {
        origin: 'hostel',
        destination: 'library',
        max_detour_meters: 3000,
        available_until: new Date(Date.now() + 7200000).toISOString(),
      },
      { pickup: 'library', destination: 'hostel' },
    ),
    null,
  );
});
test('calling windows and due stages use India dates across UTC midnight', () => {
  assert.equal(localTime(new Date('2026-10-14T20:00:00Z')).day, '2026-10-15');
  assert.equal(inCallWindow(new Date('2026-10-14T03:29:00Z')), false);
  assert.equal(inCallWindow(new Date('2026-10-14T03:30:00Z')), true);
  assert.equal(inCallWindow(new Date('2026-10-14T13:30:00Z')), false);
  assert.equal(reminderStage('2026-10-18', '2026-10-14'), 'in 4 days');
  assert.equal(reminderStage('2026-10-17', '2026-10-14'), null);
  assert.equal(reminderStage('2026-10-15', '2026-10-14'), 'tomorrow');
  assert.equal(reminderStage('2026-10-12', '2026-10-14'), null);
  assert.match(
    scriptFor('DUE_REMINDER', { title: 'Calculator', stage: 'tomorrow', end_date: '2026-10-15' }),
    /automated/,
  );
});
test('preview mode cannot reach provider or create call jobs', async () => {
  const no = () => {
    throw Error('Unexpected external action');
  };
  const s = createCallService({ settings: () => ({ live: false }), providerFactory: no, db: { query: no } });
  assert.deepEqual(await s.enqueue(), { queued: 0, mode: 'preview' });
  assert.deepEqual(await s.dispatchOne(), { skipped: true });
});
test('support retrieves policy and redacts obvious credentials/contact details', () => {
  assert.equal(retrieve('My payment failed')[0].id, 'payment');
  assert.match(
    groundedFallback('tell me about printing', retrieve('printing'), { rentals: [], wishes: [] }),
    /coming soon/,
  );
  assert.equal(
    redact('email me user@example.com and code 123456'),
    'email me [email removed] and code [number removed]',
  );
  assert.match(
    groundedFallback('when is my rental due', retrieve('rental due'), {
      rentals: [
        {
          title: 'Calculator',
          status: 'RENTAL_ACTIVE',
          due_date: '2026-10-15',
          payment_status: 'FULLY_PAID',
        },
      ],
      wishes: [],
    }),
    /2026-10-15/,
  );
});
test('unavailable AI falls back to grounded help without claiming a model response', async () => {
  const oldKey = process.env.OPENAI_API_KEY,
    oldModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'test';
  process.env.OPENAI_MODEL = 'test';
  try {
    const r = await answer('fixture', 'How does Wish Box work?', {
      save: false,
      contextOverride: { rentals: [], wishes: [] },
      transport: async () => {
        throw Error('offline');
      },
    });
    assert.equal(r.mode, 'help_library_fallback');
    assert.match(r.answer, /total price/);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = oldModel;
  }
});
