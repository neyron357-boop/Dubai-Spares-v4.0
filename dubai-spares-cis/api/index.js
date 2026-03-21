import express from 'express';
import cors from 'cors';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { createAiCore } from './ai/core.js';

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

const aiCore = createAiCore();

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

const normalize = (value = '') => value.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
const brandMatch = (orderBrand, shopBrand) => {
  const a = normalize(orderBrand);
  const b = normalize(shopBrand);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
};
const modelMatch = (orderModel, shopModel) => {
  const a = normalize(orderModel);
  const b = normalize(shopModel);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
};
const tierForOrderAndShop = (order, shop) => {
  const brands = Array.isArray(shop.specialization) ? shop.specialization : [];
  const models = Array.isArray(shop.specialization_models) ? shop.specialization_models : [];
  const years = Array.isArray(shop.specialization_years) ? shop.specialization_years.map(Number) : [];
  const brandMatched = brands.some((brand) => brandMatch(order.brand, brand));
  if (!brandMatched) return 'none';
  const modelMatched = models.some((model) => modelMatch(order.model, model));
  const yearMatched = years.includes(Number(order.year));
  if (modelMatched && yearMatched) return 'high';
  if (modelMatched) return 'medium';
  return 'low';
};

const sanitizeOrderPayload = (record, matchStats) => {
  const orderId = record.id ?? 'New Order';
  const title = `Новая заявка: ${record.brand || '-'} ${record.model || ''}`.trim();

  return {
    title,
    body: `Совпадения магазинов → High: ${matchStats.high}, Medium: ${matchStats.medium}, Low: ${matchStats.low}`,
    icon: '/icons/notification-icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      orderId,
      brand: record.brand || '',
      model: record.model || '',
      year: record.year || '',
      createdAt: record.created_at ?? new Date().toISOString(),
      matchStats
    }
  };
};

const parseMaybeJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeOrderLikePayload = (table, record) => {
  if (table === 'orders') return record;

  const payload = parseMaybeJson(record.payload_json)
    || parseMaybeJson(record.payload)
    || parseMaybeJson(record.message)
    || {};
  const preferredName = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim()
    : (typeof record.name === 'string' ? record.name : 'Public Lead');
  const preferredPhone = typeof payload.phone === 'string' && payload.phone.trim()
    ? payload.phone.trim()
    : (typeof record.phone === 'string' ? record.phone : '');

  return {
    id: record.order_id || record.id,
    created_at: record.created_at,
    brand: payload.brand || record.brand || '',
    model: payload.model || record.model || '',
    year: payload.year || record.year || '',
    name: preferredName,
    phone: preferredPhone,
    source: payload.source || 'public_form'
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

const fetchMatchingShops = async (order) => {
  const { data, error } = await supabase
    .from('shops')
    .select('id,name,specialization,specialization_models,specialization_years');

  if (error) {
    throw new Error(`Failed to fetch shops: ${error.message}`);
  }

  const tiered = { high: [], medium: [], low: [] };
  (data || []).forEach((shop) => {
    const tier = tierForOrderAndShop(order, shop);
    if (tier !== 'none') tiered[tier].push(shop);
  });

  return tiered;
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


app.post('/ai/tasks', async (req, res) => {
  const response = await aiCore.execute(req.body ?? {});
  return res.status(response.ok ? 200 : 400).json(response);
});

app.post('/webhooks/orders', validateWebhookKey, async (req, res) => {
  try {
    const payload = req.body ?? {};
    const table = payload.table ?? payload?.record?.table;

    if (table && table !== 'orders' && table !== 'client_leads') {
      return res.status(202).json({ message: 'Ignored non-orders event' });
    }

    const record = payload.record ?? payload.new ?? {};
    const normalizedRecord = normalizeOrderLikePayload(table, record);
    const tieredMatches = await fetchMatchingShops(normalizedRecord);
    const matchStats = {
      high: tieredMatches.high.length,
      medium: tieredMatches.medium.length,
      low: tieredMatches.low.length
    };

    if (matchStats.high + matchStats.medium + matchStats.low === 0) {
      return res.status(202).json({ message: 'Order has no shop specialization matches', matchStats });
    }

    const notification = sanitizeOrderPayload(normalizedRecord, matchStats);
    const result = await sendPushToAdmins(notification);

    return res.status(200).json({
      message: 'Webhook processed',
      notification,
      matchStats,
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
