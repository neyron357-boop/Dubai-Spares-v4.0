import express from 'express';
import cors from 'cors';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'WEBHOOK_API_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT'
];

const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required env vars: ${missingEnvVars.join(', ')}`);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const sanitizeOrderPayload = (payload) => {
  const record = payload?.record ?? payload?.new ?? {};
  const orderId = record.id ?? 'New Order';
  const customerName = record.customer_name ?? record.customer ?? 'Unknown customer';
  const orderTotal = record.total_amount ?? record.total ?? null;

  return {
    title: 'New order received',
    body: orderTotal
      ? `Order #${orderId} from ${customerName}. Total: ${orderTotal}`
      : `Order #${orderId} from ${customerName}.`,
    icon: '/icons/notification-icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      orderId,
      customerName,
      createdAt: record.created_at ?? new Date().toISOString()
    }
  };
};

const getAdminSubscriptions = async () => {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_agent')
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to fetch subscriptions: ${error.message}`);
  }

  return data;
};

const deactivateSubscription = async (id) => {
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error(`Unable to deactivate subscription ${id}:`, error.message);
  }
};

const sendPushToAdmins = async (notificationPayload) => {
  const subscriptions = await getAdminSubscriptions();
  if (subscriptions.length === 0) {
    return { delivered: 0, failed: 0, total: 0 };
  }

  let delivered = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      const webPushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth
        }
      };

      try {
        await webpush.sendNotification(webPushSubscription, JSON.stringify(notificationPayload));
        delivered += 1;
      } catch (error) {
        failed += 1;

        if (error.statusCode === 404 || error.statusCode === 410) {
          await deactivateSubscription(subscription.id);
        }

        console.error(`Push failed for subscription ${subscription.id}:`, error.message);
      }
    })
  );

  return { delivered, failed, total: subscriptions.length };
};

const validateWebhookKey = (req, res, next) => {
  const providedKey = req.header('x-api-key');
  if (!providedKey || providedKey !== process.env.WEBHOOK_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized webhook caller' });
  }

  return next();
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/webhooks/orders', validateWebhookKey, async (req, res) => {
  try {
    const payload = req.body ?? {};
    const table = payload.table ?? payload?.record?.table;

    if (table && table !== 'orders') {
      return res.status(202).json({ message: 'Ignored non-orders event' });
    }

    const notification = sanitizeOrderPayload(payload);
    const result = await sendPushToAdmins(notification);

    return res.status(200).json({
      message: 'Webhook processed',
      notification,
      result
    });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return res.status(500).json({ error: 'Failed to process webhook' });
  }
});

app.post('/subscriptions', async (req, res) => {
  const registrationKey = req.header('x-registration-key');
  if (!registrationKey || registrationKey !== process.env.DEVICE_REGISTRATION_KEY) {
    return res.status(401).json({ error: 'Unauthorized subscription writer' });
  }

  const { endpoint, keys, userAgent } = req.body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription payload' });
  }

  const payload = {
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: userAgent ?? null,
    is_active: true,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(payload, { onConflict: 'endpoint' });

  if (error) {
    return res.status(500).json({ error: `Failed to store subscription: ${error.message}` });
  }

  return res.status(201).json({ message: 'Subscription saved' });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Notification worker listening on :${port}`));
