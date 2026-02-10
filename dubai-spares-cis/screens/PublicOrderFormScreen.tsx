import React, { useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, Upload, Camera } from 'lucide-react';
import { ensurePublicImageUrls, optimizeImageForUpload } from '../storage/photos';
import { isCloudSyncConfigured, supabase } from '../supabase';
import { BRAND_MODELS, BRANDS, YEARS } from '../constants';
import { Source } from '../types';

type FormStep = 1 | 2 | 3 | 4;

const TOTAL_STEPS = 4;
const DEFAULT_SOURCE: Source = Source.WHATSAPP;

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const PublicOrderFormScreen: React.FC = () => {
  const [step, setStep] = useState<FormStep>(1);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [partList, setPartList] = useState('');
  const [vin, setVin] = useState('');
  const [carPhotoData, setCarPhotoData] = useState<string | null>(null);
  const [vinPhotoData, setVinPhotoData] = useState<string | null>(null);
  const [customerContact, setCustomerContact] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showThanks, setShowThanks] = useState(false);

  const carInputRef = useRef<HTMLInputElement | null>(null);
  const vinInputRef = useRef<HTMLInputElement | null>(null);

  const modelOptions = useMemo(() => BRAND_MODELS[brand] || [], [brand]);

  const handleFileToDataUrl = (file: File, onLoad: (value: string) => void) => {
    const reader = new FileReader();
    reader.onloadend = () => onLoad(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const canContinue =
    (step === 1 && Boolean(brand.trim() && model.trim() && year.trim())) ||
    (step === 2 && Boolean(partList.trim())) ||
    step === 3 ||
    (step === 4 && Boolean(customerContact.trim()));

  const goNext = () => {
    if (!canContinue) return;
    setStep((current) => Math.min(TOTAL_STEPS, current + 1) as FormStep);
  };

  const goBack = () => setStep((current) => Math.max(1, current - 1) as FormStep);

  const resetForm = () => {
    setStep(1);
    setBrand('');
    setModel('');
    setYear('');
    setPartList('');
    setVin('');
    setCarPhotoData(null);
    setVinPhotoData(null);
    setCustomerContact('');
  };

  const submitOrder = async () => {
    if (!brand.trim() || !model.trim() || !year.trim() || !partList.trim() || !customerContact.trim()) {
      alert('Please complete the required fields before submitting.');
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
      const now = new Date().toISOString();

      let uploadedCarPhotos: string[] = [];
      let uploadedVinPhotos: string[] = [];

      if (carPhotoData) {
        const compressed = await optimizeImageForUpload(carPhotoData, `public-order:${orderId}:${partId}:car`);
        uploadedCarPhotos = await ensurePublicImageUrls([compressed], `orders/${orderId}/parts/${partId}`);
      }

      if (vinPhotoData) {
        const compressedVin = await optimizeImageForUpload(vinPhotoData, `public-order:${orderId}:vin`);
        uploadedVinPhotos = await ensurePublicImageUrls([compressedVin], `orders/${orderId}/vin`);
      }

      const notes = [
        {
          id: createId(),
          text: `Public Request Part List:\n${partList.trim()}`,
          photos: [],
          audios: [],
          createdAt: Date.now()
        }
      ];

      const { error: orderError } = await supabase.from('orders').insert({
        id: orderId,
        brand: brand.trim(),
        model: model.trim(),
        year: year.trim(),
        vin: vin.trim(),
        vin_photo_url: uploadedVinPhotos[0] || null,
        status: 'new_inquiry',
        sales_status: 'Inquiry',
        client_name: 'Public Lead',
        customer_contact: customerContact.trim(),
        source: DEFAULT_SOURCE,
        priority: 'MEDIUM',
        car_photos: uploadedCarPhotos,
        markup_percent: 20,
        exchange_rate: 3.67,
        is_archived: false,
        is_sold: false,
        is_vip: false,
        is_pinned: false,
        is_lead: true,
        notes,
        created_at: now,
        updated_at: now
      });

      if (orderError) throw orderError;

      const { error: partError } = await supabase.from('parts').insert({
        id: partId,
        order_id: orderId,
        name: 'Requested parts list',
        photos: uploadedCarPhotos,
        photo_url: uploadedCarPhotos[0] || null,
        is_found: false
      });

      if (partError) throw partError;

      setShowThanks(true);
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit request.';
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const progress = (step / TOTAL_STEPS) * 100;

  if (showThanks) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-10 text-white">
        <div className="mx-auto w-full max-w-xl rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-[0_40px_120px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
            <Check className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Request Received!</h1>
          <p className="mt-3 text-base text-slate-200">
            We are searching for your parts now. We will contact you on WhatsApp shortly.
          </p>
          <button
            type="button"
            onClick={() => setShowThanks(false)}
            className="mt-8 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:scale-[1.02]"
          >
            Submit another request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-6 text-white sm:py-10">
      <div className="mx-auto w-full max-w-2xl rounded-[32px] border border-white/10 bg-white/5 p-5 shadow-[0_25px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.26em] text-slate-300">Dubai Spares Concierge</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Tell us what your car needs.</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            Tell us what your car needs, and our experts will find the best options in Dubai.
          </p>
        </div>

        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
            <span>Step {step} of {TOTAL_STEPS}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-yellow-100 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="space-y-4 transition-all duration-500">
          {step === 1 && (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Brand</span>
                <select
                  value={brand}
                  onChange={(e) => {
                    setBrand(e.target.value);
                    setModel('');
                  }}
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition focus:border-white/50"
                >
                  <option value="">Select brand</option>
                  {BRANDS.map((item) => (
                    <option key={item} value={item} className="text-slate-900">
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Model</span>
                {modelOptions.length > 0 ? (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition focus:border-white/50"
                  >
                    <option value="">Select model</option>
                    {modelOptions.map((item) => (
                      <option key={item} value={item} className="text-slate-900">
                        {item}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Type model"
                    className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition placeholder:text-slate-400 focus:border-white/50"
                  />
                )}
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Year</span>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition focus:border-white/50"
                >
                  <option value="">Select year</option>
                  {YEARS.map((item) => (
                    <option key={item} value={item} className="text-slate-900">
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {step === 2 && (
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">What parts are you looking for?</span>
              <textarea
                value={partList}
                onChange={(e) => setPartList(e.target.value)}
                rows={9}
                placeholder="Brake pads front + rear\nEngine mounts\nLeft mirror cover..."
                className="w-full rounded-[28px] border border-white/15 bg-white/10 px-5 py-4 text-base outline-none transition placeholder:text-slate-400 focus:border-white/50"
              />
            </label>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => vinInputRef.current?.click()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-3xl border border-white/20 bg-white/10 text-sm font-semibold transition hover:bg-white/15"
              >
                <Camera className="h-4 w-4" />
                Scan/Upload VIN Photo {vinPhotoData ? '✓' : ''}
              </button>
              <input
                ref={vinInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileToDataUrl(file, setVinPhotoData);
                }}
              />

              <button
                type="button"
                onClick={() => carInputRef.current?.click()}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-3xl border border-white/20 bg-white/10 text-sm font-semibold transition hover:bg-white/15"
              >
                <Upload className="h-4 w-4" />
                Upload Car Photo {carPhotoData ? '✓' : ''}
              </button>
              <input
                ref={carInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileToDataUrl(file, setCarPhotoData);
                }}
              />

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Manual VIN entry</span>
                <input
                  type="text"
                  value={vin}
                  onChange={(e) => setVin(e.target.value)}
                  placeholder="WDB123456789..."
                  className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-base outline-none transition placeholder:text-slate-400 focus:border-white/50"
                />
              </label>
            </div>
          )}

          {step === 4 && (
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-300">Phone Number / WhatsApp</span>
              <input
                type="tel"
                value={customerContact}
                onChange={(e) => setCustomerContact(e.target.value)}
                placeholder="+971..."
                className="h-14 w-full rounded-3xl border border-white/15 bg-white/10 px-5 text-lg outline-none transition placeholder:text-slate-400 focus:border-white/50"
              />
            </label>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1 || isSubmitting}
            className="flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-full border border-white/20 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canContinue || isSubmitting}
              className="flex h-12 min-w-[140px] items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-slate-950 transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submitOrder}
              disabled={!canContinue || isSubmitting}
              className="h-12 min-w-[160px] rounded-full bg-gradient-to-r from-amber-200 to-white px-6 text-sm font-semibold text-slate-950 transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicOrderFormScreen;
