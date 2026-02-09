import React, { useRef, useState } from 'react';
import { optimizeImageForUpload, ensurePublicImageUrls } from '../storage/photos';
import { isCloudSyncConfigured, supabase } from '../supabase';

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const PublicOrderFormScreen: React.FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [vin, setVin] = useState('');
  const [partName, setPartName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const onPickPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhotoData(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!brand || !model || !partName || !customerContact) {
      alert('Please fill in brand, model, part name, and contact.');
      return;
    }

    if (!isCloudSyncConfigured || !supabase) {
      alert('Order form is temporarily unavailable.');
      return;
    }

    setIsSubmitting(true);

    try {
      const orderId = createId();
      const partId = createId();

      let partPhotos: string[] = [];
      if (photoData) {
        const compressed = await optimizeImageForUpload(photoData, `public-order:${orderId}:part:${partId}`);
        partPhotos = await ensurePublicImageUrls([compressed], `orders/${orderId}/parts/${partId}`);
      }

      const { error: orderError } = await supabase.from('orders').insert({
        id: orderId,
        brand,
        model,
        year,
        vin,
        status: 'new_inquiry',
        client_name: 'Public Lead',
        customer_contact: customerContact,
        source: 'Другое',
        priority: 'MEDIUM',
        car_photos: [],
        markup_percent: 20,
        exchange_rate: 3.67,
        is_archived: false,
        is_sold: false,
        is_vip: false,
        is_pinned: false,
        is_lead: true,
        notes: [],
        sales_status: 'Inquiry',
        created_at: Date.now(),
        updated_at: Date.now()
      });

      if (orderError) throw orderError;

      const { error: partError } = await supabase.from('parts').insert({
        id: partId,
        order_id: orderId,
        name: partName,
        photos: partPhotos,
        photo_url: partPhotos[0] || null,
        is_found: false
      });

      if (partError) throw partError;

      setSuccess(true);
      setBrand('');
      setModel('');
      setYear('');
      setVin('');
      setPartName('');
      setCustomerContact('');
      setPhotoData(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit request.';
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h1 className="text-xl font-black">Order Request</h1>
        <p className="text-xs text-gray-500">Send your spare part request and we will contact you shortly.</p>

        {success && <div className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 p-3 rounded-xl">Submitted successfully.</div>}

        <form onSubmit={onSubmit} className="space-y-3">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Car Brand" className="w-full p-3 rounded-xl border border-gray-200" />
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" className="w-full p-3 rounded-xl border border-gray-200" />
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" className="w-full p-3 rounded-xl border border-gray-200" />
          <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="VIN" className="w-full p-3 rounded-xl border border-gray-200 uppercase" />
          <input value={partName} onChange={(e) => setPartName(e.target.value)} placeholder="Part Name" className="w-full p-3 rounded-xl border border-gray-200" />
          <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder="Phone or Handle" className="w-full p-3 rounded-xl border border-gray-200" />

          <div className="space-y-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="w-full p-3 rounded-xl border border-dashed border-gray-300 text-sm font-bold text-gray-500">Upload Photo</button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
            {photoData && <img src={photoData} className="w-24 h-24 object-cover rounded-lg border border-gray-100" />}
          </div>

          <button disabled={isSubmitting} className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold">
            {isSubmitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PublicOrderFormScreen;
