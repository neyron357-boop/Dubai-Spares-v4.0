import { ArrowRight, CarFront, CircleAlert, CircleCheck, Clock3, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, PageHeader, Panel } from '../components/ui';
import SafeImage from '../components/SafeImage';
import { useStore } from '../store';
import { Priority } from '../types';
import { getGreeting } from '../utils/greeting';
import { isLeadOrder } from '../utils/orderClassification';
import { calculateOrderTotals } from '../utils/quotePricing';

export default function MorningBossScreen() {
  const navigate = useNavigate();
  const { orders } = useStore();
  const active = useMemo(
    () => orders.filter((order) => !order.isArchived && !order.isSold && !isLeadOrder(order)),
    [orders],
  );
  const urgent = active.filter((order) => order.priority === Priority.HIGH);
  const totalParts = active.reduce((sum, order) => sum + order.parts.length, 0);
  const foundParts = active.reduce(
    (sum, order) =>
      sum + order.parts.filter((part) => part.isFound || part.variants.length > 0).length,
    0,
  );
  const quoteVolume = active.reduce((sum, order) => sum + calculateOrderTotals(order).totalAed, 0);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const createdToday = orders.filter(
    (order) => !isLeadOrder(order) && order.createdAt >= startOfDay.getTime(),
  ).length;
  const leads = orders.filter((order) => !order.isArchived && isLeadOrder(order)).length;
  const percent = totalParts ? Math.round((foundParts / totalParts) * 100) : 0;
  const metrics = [
    { label: 'В работе', value: active.length, hint: 'активных заказов', icon: CarFront },
    {
      label: 'Создано сегодня',
      value: createdToday,
      hint: 'заказов на этом устройстве',
      icon: Clock3,
    },
    {
      label: 'Новые обращения',
      value: leads,
      hint: 'заявок перед началом работы',
      icon: CircleAlert,
    },
  ];
  return (
    <div className="ui-page space-y-6">
      <PageHeader
        title={getGreeting()}
        eyebrow="Обзор работы"
        description={new Date().toLocaleDateString('ru-RU', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        actions={
          <Button icon={ArrowRight} onClick={() => navigate('/orders')}>
            К заказам
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {metrics.map(({ label, value, hint, icon: Icon }) => (
          <Panel key={label}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-600">{label}</h2>
              <Icon size={19} className="text-slate-400" aria-hidden="true" />
            </div>
            <p className="mt-4 text-4xl font-bold tabular-nums">{value}</p>
            <p className="ui-description">{hint}</p>
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Panel
          title="Состояние поиска"
          icon={CircleCheck}
          description={`${foundParts} из ${totalParts} позиций в активных заказах найдены.`}
        >
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-slate-600">Детали с предложениями</span>
            <strong>{percent}%</strong>
          </div>
          <div
            role="progressbar"
            aria-label="Найденные детали"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 overflow-hidden rounded-full bg-slate-100"
          >
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
          </div>
        </Panel>
        <Panel title="Стоимость активных смет" icon={Wallet}>
          <p className="text-3xl font-bold tabular-nums">
            {quoteVolume.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}{' '}
            <span className="text-base font-semibold text-slate-500">AED</span>
          </p>
          <p className="ui-description">
            Сумма по текущим предложениям с учётом доставки и скидок.
          </p>
        </Panel>
      </div>
      <Panel
        title="Приоритетные заказы"
        description="Заказы с высоким приоритетом, которым нужно внимание."
        icon={CircleAlert}
      >
        {urgent.length ? (
          <div className="divide-y divide-slate-100">
            {urgent.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => navigate(`/order/${order.id}`)}
                className="flex w-full items-center gap-3 rounded-xl py-4 text-left hover:bg-slate-50"
              >
                <SafeImage
                  src={order.carPhotos?.[0] || order.carPhotoUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-xl object-cover bg-slate-100"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">
                    {order.brand} {order.model}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {order.clientName || 'Клиент не указан'} · {order.parts.length} позиций
                  </span>
                </span>
                <ArrowRight size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CircleCheck}
            title="Нет срочных заказов"
            description="Заказы с высоким приоритетом появятся здесь."
          />
        )}
      </Panel>
    </div>
  );
}
