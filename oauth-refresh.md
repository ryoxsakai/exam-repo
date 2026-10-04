# MCP OAuth connection lifetime

New connections receive the existing 24-hour access token and an opaque refresh token. Each consent creates a family with a fixed expiry 30 days later; refreshing never extends this deadline. Access expiry is capped at the family deadline. Existing access tokens continue until their original expiry and require one reconnect to acquire refresh capability.

Only SHA-256 refresh hashes are stored in D1. Refresh tokens are client-, issuer-, and API-key/signing-secret-version-bound. Each rotation consumes the current token transactionally and creates one successor. Concurrent retries within five seconds receive the same HMAC-derived successor without storing raw tokens. A used successor or reuse outside that window revokes the family, including its access tokens. Scope may decrease and cannot increase on subsequent refreshes. Applications should serialize refresh calls and persist the returned successor atomically.

`POST /oauth/revoke` accepts `client_id` and `token` (refresh token) and revokes the whole family. Unknown tokens produce the same empty 200 response. Browser logout only clears the browser login cookie; disconnect/revoke the app connection separately. API key or signing secret changes invalidate new connection families. Existing legacy access tokens preserve their previous behavior.

Schema is created lazily through D1 `CREATE TABLE IF NOT EXISTS` when OAuth runs. No manual production-data migration or new binding/secret is required. Expired families and their refresh hashes are removed; hashes of consumed tokens remain until family expiry for reuse detection. Revocation adds a D1 read to authenticated requests carrying a new family-bound access token. Rollback to an old Worker would stop refresh/revocation enforcement, so prefer a forward fix for any production issue.

Verification: `npm ci --prefix panel`, `npm run build --prefix panel`, `node scripts/test-oauth-browser-session.cjs`, `node scripts/test-oauth-refresh.cjs`. All credentials in those tests are synthetic and SQLite runs in memory.
