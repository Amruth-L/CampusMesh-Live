const assert = require("node:assert/strict");
// Tokens are revocable. Each independent journey signs in instead of reusing a
// fixture token that an earlier logout or password change may have revoked.
module.exports = async function browserToken(request, base, user) {
  const response = await request.post(base + "/login", {
    data: { email: user.id + "@dbit.co.in", password: "review-password" },
  });
  assert.equal(response.status(), 200, "Local QA sign-in must succeed");
  const body = await response.json();
  assert.ok(body.token);
  return body.token;
};
