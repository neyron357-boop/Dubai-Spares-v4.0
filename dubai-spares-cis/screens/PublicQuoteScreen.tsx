import React, { useEffect, useState } from 'react';
import { offlineDb } from '../storage/offlineDb';
import { Order } from '../types';

const PublicQuoteScreen: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    let active = true;
    void offlineDb.getOrders().then((orders) => {
      if (!active) return;
      setOrder((orders.find((item) => item.id === orderId) as Order | undefined) || null);
    });
    return () => { active = false; };
  }, [orderId]);

  if (!order) {
    return <div className="min-h-screen p-6 text-sm text-gray-600">Смета не найдена в локальной базе.</div>;
  }

  return (
    <div className="min-h-screen bg-white p-6 space-y-3 text-sm text-gray-800">
      <h1 className="text-xl font-black">{order.brand} {order.model} {order.year}</h1>
      <p>VIN: {order.vin || '—'}</p>
      <p>Клиент: {order.clientName || '—'}</p>
      <div className="pt-2">
        <h2 className="font-bold mb-1">Детали</h2>
        <ul className="list-disc pl-5 space-y-1">
          {order.parts.map((part) => <li key={part.id}>{part.name}</li>)}
        </ul>
      </div>
    </div>
  );
};

export default PublicQuoteScreen;
