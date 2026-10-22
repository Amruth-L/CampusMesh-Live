# Private CampusMesh OTP mailer

This Lambda sends CampusMesh signup and password-reset codes to one `@dbit.co.in` address per invocation. Render calls the Lambda Invoke API over HTTPS using IAM credentials; Lambda connects to Gmail with TLS. It has no HTTP server, public function URL, or arbitrary email endpoint. SMTP acceptance confirms provider handoff, not inbox delivery.

Use Node.js 22 or newer, handler `index.handler`, a 25-second Lambda timeout, and an internet-connected default Lambda network (no VPC needed). Set only `EMAIL_USER` and `EMAIL_PASS` for the existing Gmail sender and its app password through AWS environment configuration. Never put credentials in the deployment archive or invocation payload.

Grant the backend identity only `lambda:InvokeFunction` on this specific function ARN. Invoke with `InvocationType: RequestResponse` and SDK `maxAttempts: 1`. Do not use asynchronous invocation, event sources, automatic retries or a public function URL. The app owns OTP generation, verification, expiry, attempt limits, resend cooldowns and authorization.

The JSON event is:

```json
{"version":1,"to":"student@dbit.co.in","purpose":"verify","code":"123456","name":"Student"}
```

`purpose` is exactly `verify` or `reset`; `code` is a six-digit string; `name` is optional with a 120-character limit. Addresses normalize to lowercase. Personal email addresses, additional recipients, unknown fields, and arbitrary subjects, HTML, headers or senders are rejected before connecting to SMTP.

Success is `{"ok":true,"messageId":"..."}`. Failure is `{"ok":false,"code":"INVALID_REQUEST","retryable":false}`. Other failure codes are `CONFIGURATION`, `SMTP_AUTHENTICATION`, `SMTP_TEMPORARY`, `SMTP_REJECTED`, `DELIVERY_TIMEOUT`, `DELIVERY_UNCONFIRMED` and `DELIVERY_UNAVAILABLE`. A failure object is a successful Lambda invocation with a failed application result; callers must explicitly check `ok === true`. Never expose configuration/provider details to public clients. `retryable` indicates whether a later user-requested resend may succeed, not permission to retry the same invocation automatically.

The handler makes one SMTP attempt with a 15-second deadline and closes its connection. Raw provider errors, recipients, passwords and codes are never logged. Gmail account limits and availability still apply; this is suitable for the current campus preview, not a replacement for an approved production transactional email service.

Run `npm test` for local tests with injected transports. Run `npm run build -- /tmp/campusmesh-otp-mailer.zip` to produce a deployment ZIP with the pinned Nodemailer dependency. Packaging needs npm registry access and the `zip` command. No email is sent by tests or packaging.
