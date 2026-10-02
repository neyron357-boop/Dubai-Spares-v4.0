import {
  Archive,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileCheck2,
  ListChecks,
  LoaderCircle,
  MapPin,
  Package,
  PackagePlus,
  ScanLine,
  Search,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { OrderOverviewMissingInput, OrderOverviewView } from '../utils/orderOverview';
import '../styles/order-overview-summary.css';

const actionIcons = {
  restore: Archive,
  add_parts: PackagePlus,
  deposit: Wallet,
  search: Search,
  offers: ListChecks,
  quote: FileCheck2,
  prepayment: CreditCard,
  proof: Camera,
};

const missingIcons = {
  vin: ScanLine,
  photo: Camera,
  contact: UserRound,
  delivery: MapPin,
};

export default function OrderOverviewSummary({
  view,
  quoteTotal,
  profit,
  depositAmount,
  busy = false,
  error,
  onAction,
  onOpenSearch,
  onOpenFinance,
  onMissingInput,
}: {
  view: OrderOverviewView;
  quoteTotal: string | null;
  profit: string | null;
  depositAmount: string | null;
  busy?: boolean;
  error?: string;
  onAction: () => void;
  onOpenSearch: () => void;
  onOpenFinance: () => void;
  onMissingInput: (item: OrderOverviewMissingInput) => void;
}) {
  const ActionIcon = actionIcons[view.nextAction.id];
  const PaymentIcon = view.depositPaid || view.fullPrepaymentPaid ? CheckCircle2 : CreditCard;
  const paymentLabel = view.fullPrepaymentPaid
    ? 'Полная предоплата'
    : view.depositPaid
      ? 'Депозит внесён'
      : 'Оплата не отмечена';

  return (
    <section className="order-overview-summary" aria-label="Сводка заказа">
      <div
        className={`order-overview-next ${view.archived ? 'is-archived' : ''}`}
        aria-busy={busy || undefined}
      >
        <div className="order-overview-next-heading">
          <span className="order-overview-next-icon" aria-hidden="true">
            <ActionIcon size={21} strokeWidth={1.7} />
          </span>
          <div>
            <p className="order-overview-eyebrow">
              {view.archived
                ? 'Архивный заказ'
                : view.completed
                  ? 'Заказ завершён'
                  : 'Следующий шаг'}
            </p>
            <h2>{view.nextAction.title}</h2>
          </div>
        </div>
        <p className="order-overview-next-description">{view.nextAction.description}</p>
        <button
          type="button"
          className="order-overview-next-action"
          disabled={busy}
          onClick={onAction}
        >
          <span>{busy ? 'Выполняю…' : view.nextAction.label}</span>
          {busy ? (
            <LoaderCircle size={16} strokeWidth={1.7} className="is-spinning" aria-hidden="true" />
          ) : (
            <ArrowRight size={16} strokeWidth={1.7} aria-hidden="true" />
          )}
        </button>
        {error && (
          <p className="order-overview-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="order-overview-facts">
        <button
          type="button"
          className="order-overview-fact"
          onClick={onOpenSearch}
          disabled={busy}
          aria-label={`Подбор деталей: ${view.sourcedParts} из ${view.totalParts}. Открыть поиск`}
        >
          <span className="order-overview-fact-label">
            <Package size={16} strokeWidth={1.7} aria-hidden="true" />
            Подбор
            <ChevronRight size={14} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <strong>
            {view.sourcedParts} <span>из {view.totalParts}</span>
          </strong>
          <small>{view.totalParts ? `Выбрано: ${view.selectedParts}` : 'Список пока пуст'}</small>
        </button>
        <button
          type="button"
          className={`order-overview-fact ${quoteTotal === null ? 'is-empty' : ''}`}
          onClick={onOpenFinance}
          disabled={busy}
          aria-label={`Смета: ${quoteTotal ?? 'Цены не указаны'}. Открыть финансы`}
        >
          <span className="order-overview-fact-label">
            <FileCheck2 size={16} strokeWidth={1.7} aria-hidden="true" />
            Смета
            <ChevronRight size={14} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <strong>{quoteTotal ?? 'Цены не указаны'}</strong>
          <small>
            {view.quoteCreated
              ? 'Смета создана'
              : view.totalParts
                ? `С ценой: ${view.pricedParts} из ${view.totalParts}`
                : 'Добавьте детали'}
          </small>
        </button>
      </div>

      <div className="order-overview-financials">
        <button
          type="button"
          className="order-overview-payment"
          onClick={onOpenFinance}
          disabled={busy}
          aria-label={`Открыть финансы. ${paymentLabel}`}
        >
          <span
            className={`order-overview-payment-icon ${view.depositPaid || view.fullPrepaymentPaid ? 'is-paid' : ''}`}
            aria-hidden="true"
          >
            <PaymentIcon size={19} strokeWidth={1.7} />
          </span>
          <span className="order-overview-payment-copy">
            <small>Оплата</small>
            <strong>{paymentLabel}</strong>
            {view.fullPrepaymentPaid ? (
              <span>Отмечена как полученная</span>
            ) : view.depositPaid && depositAmount !== null ? (
              <span>{depositAmount}</span>
            ) : null}
          </span>
          <ChevronRight size={16} strokeWidth={1.7} aria-hidden="true" />
        </button>
        {profit !== null && (
          <div className="order-overview-profit">
            <span>Расчётная маржа</span>
            <strong>{profit}</strong>
          </div>
        )}
      </div>

      {!view.archived && view.missingInputs.length > 0 && (
        <details className="order-overview-missing">
          <summary>
            <ClipboardList size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>Дополнить данные</span>
            <span className="order-overview-missing-count">{view.missingInputs.length}</span>
            <ChevronDown size={17} strokeWidth={1.7} aria-hidden="true" />
          </summary>
          <div className="order-overview-missing-list">
            {view.missingInputs.map((item) => {
              const MissingIcon = missingIcons[item.id];
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => onMissingInput(item)}
                  disabled={busy}
                >
                  <MissingIcon size={18} strokeWidth={1.7} aria-hidden="true" />
                  <span>{item.label}</span>
                  <ChevronRight size={16} strokeWidth={1.7} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}
