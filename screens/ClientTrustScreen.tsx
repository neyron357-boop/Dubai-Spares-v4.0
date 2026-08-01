import React from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileText,
  MessageCircle,
  PackageCheck,
  Search,
  ShieldCheck,
  Truck,
  WalletCards,
  XCircle
} from 'lucide-react';

const processSteps = [
  { title: 'Заявка и данные', body: 'Собираем VIN, фото авто, список деталей, сторону детали и страну доставки.', icon: FileText },
  { title: 'Депозит на поиск', body: 'До депозита возможна только предварительная оценка. Реальный поиск начинается после оплаты.', icon: WalletCards },
  { title: 'Поиск и смета', body: 'Проверяем поставщиков, реальные фото, состояние, сроки, упаковку и доставку.', icon: Search },
  { title: 'Предоплата и закупка', body: 'Полная оплата нужна до покупки, потому что товар берётся под конкретного клиента.', icon: ShieldCheck },
  { title: 'Proof Pack', body: 'Фиксируем фото, видео, дефекты, маркировки, упаковку и передачу в cargo.', icon: Camera },
  { title: 'Cargo', body: 'После передачи перевозчику ответственность за транспортировку переходит к cargo.', icon: Truck }
];

const proofItems = [
  'фото детали у поставщика',
  'фото маркировок и серийных номеров',
  'фото дефектов и состояния',
  'видео проверки',
  'фото после покупки',
  'фото упаковки',
  'cargo receipt'
];

const riskyDeals = [
  'оплата только после получения',
  'отказ предоставить VIN или фото авто',
  '50/50 без принятия риска продавца',
  'спор до оплаты и агрессивные условия',
  'дорогая или хрупкая деталь без cargo risk',
  'слишком маленькая маржа для сложного заказа'
];

const ClientTrustScreen: React.FC = () => (
  <div className="min-h-[100dvh] bg-slate-100 px-3 py-4 text-slate-900 sm:px-6">
    <main className="mx-auto flex max-w-5xl flex-col gap-4">
      <section className="overflow-hidden rounded-3xl bg-[#0f1f3d] text-white shadow-[0_18px_44px_rgba(15,31,61,0.24)]">
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-200">Dubai-Spares Safety Sales</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-black leading-tight sm:text-5xl">Безопасная покупка автозапчастей из Дубая</h1>
            <p className="mt-4 max-w-2xl text-base font-semibold text-blue-100">Мы работаем как система, а не как случайный посредник: сначала проверяем данные и условия, затем ищем, фиксируем доказательства, закупаем и передаём в cargo.</p>
          </div>
          <div className="flex items-center justify-center">
            <div className="grid h-28 w-28 place-items-center rounded-3xl border border-white/15 bg-white/10">
              <img src="/icon-512.png" alt="Dubai-Spares" className="h-20 w-20 object-contain" />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {processSteps.map(({ title, body, icon: Icon }) => (
          <article key={title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
              <Icon size={19} />
            </div>
            <h2 className="mt-3 text-base font-black">{title}</h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">{body}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-700"><CheckCircle2 size={15} /> Почему нужна предоплата</p>
          <div className="mt-4 space-y-3 text-sm font-semibold text-slate-700">
            <p>Запчасти на разборках не резервируются надолго. Поставщик не держит товар без оплаты, а продавец не может покупать деталь на себя и ждать, передумает клиент или нет.</p>
            <p>Депозит оплачивает реальный поиск: звонки, проверку наличия, коммуникацию с поставщиками и выезд на рынок. Полная предоплата нужна перед закупкой, потому что товар покупается под конкретный VIN и конкретного клиента.</p>
          </div>
        </div>

        <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-900 shadow-sm">
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em]"><AlertTriangle size={15} /> Хрупкие детали и cargo</p>
          <p className="mt-4 text-sm font-semibold leading-relaxed">Фары, стекло, зеркала, бамперы, кузовные элементы, электронные блоки и дорогие детали требуют усиленной упаковки. После передачи в cargo риск повреждения при перевозке относится к перевозчику, поэтому клиент должен проверить товар при получении.</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500"><PackageCheck size={15} /> Proof Pack</p>
          <div className="mt-4 grid gap-2">
            {proofItems.map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                <CheckCircle2 size={15} className="shrink-0 text-emerald-500" /> {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-rose-200 bg-white p-5 shadow-sm">
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-rose-700"><XCircle size={15} /> Когда мы можем отказаться</p>
          <div className="mt-4 grid gap-2">
            {riskyDeals.map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
                <AlertTriangle size={15} className="shrink-0" /> {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Главный принцип</p>
            <h2 className="mt-2 text-2xl font-black">Сначала доверие и защита сделки, потом поиск, потом закупка.</h2>
          </div>
          <a href="#/request" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-sm font-black text-white">
            <MessageCircle size={17} /> Оставить заявку
          </a>
        </div>
      </section>
    </main>
  </div>
);

export default ClientTrustScreen;

