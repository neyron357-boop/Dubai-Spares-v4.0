# Notification Worker (DigitalOcean)

This service is an Express.js microservice that accepts Supabase database webhooks for new `orders` rows and sends Web Push notifications to subscribed admin devices.

## Environment variables

Set these variables in your DigitalOcean App Platform / Droplet environment:

- `PORT` (optional, defaults to `8080`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WEBHOOK_API_KEY` (shared secret used by Supabase webhook via `x-api-key` header)
- `DEVICE_REGISTRATION_KEY` (shared secret for client subscription registration endpoint)
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (e.g. `mailto:admin@yourdomain.com`)

## Endpoints

- `GET /health` — health check.
- `POST /webhooks/orders` — Supabase webhook endpoint.
  - Requires header: `x-api-key: <WEBHOOK_API_KEY>`
  - Sends notification with:
    - `title`
    - `body`
    - `icon`
    - `vibrate: [200, 100, 200]`
- `POST /subscriptions` — saves PWA subscriptions in Supabase.
  - Requires header: `x-registration-key: <DEVICE_REGISTRATION_KEY>`
  - Body example:

```json
{
  "endpoint": "https://...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  },
  "userAgent": "Mozilla/5.0"
}
```

## Supabase setup

1. Run the SQL migration in `supabase/migrations/20260214100000_create_push_subscriptions_table.sql`.
2. In Supabase dashboard, create a **Database Webhook** for table `orders`, event `INSERT`, URL:
   `https://<your-worker-domain>/webhooks/orders`
3. Add header in webhook settings:
   - `x-api-key: <WEBHOOK_API_KEY>`

## Local run

```bash
cd api
npm install
npm start
```
