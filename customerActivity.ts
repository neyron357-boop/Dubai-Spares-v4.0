export type CustomerActivityType =
  | 'tracking_opened'
  | 'tracking_view_heartbeat'
  | 'telegram_subscription_created'
  | 'telegram_subscription_confirmed'
  | 'telegram_bot_interaction'
  | 'notification_event_received'
  | 'notification_sent'
  | 'relevance_prompt_shown'
  | 'relevance_confirmed'
  | 'relevance_declined'
  | 'search_paused';

export interface CustomerActivityLogEntry {
  id: string;
  orderId: string;
  type: CustomerActivityType;
  createdAt: number;
  actor: 'customer' | 'telegram_bot' | 'manager' | 'system';
  channel: 'tracking_page' | 'telegram' | 'admin' | 'system';
  summary: string;
  meta?: Record<string, unknown>;
}

const CUSTOMER_LOGS_KEY = 'dubai_spares_customer_activity_logs_v1';
export const getOrderCustomerLogs = (orderId: string): CustomerActivityLogEntry[] => {
  try {
    const entries = JSON.parse(localStorage.getItem(CUSTOMER_LOGS_KEY) || '[]');
    return Array.isArray(entries)
      ? entries
          .filter((entry) => entry.orderId === orderId)
          .sort((a, b) => b.createdAt - a.createdAt)
      : [];
  } catch {
    return [];
  }
};
