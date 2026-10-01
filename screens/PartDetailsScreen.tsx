import '../styles/part-details.css';
import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardPaste,
  Copy,
  FileText,
  Images,
  Layers3,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ConfirmModal from '../components/ConfirmModal';
import ImagePreview from '../components/ImagePreview';
import PartOfferCard, { formatOfferPrice } from '../components/PartOfferCard';
import PartOfferEditor, { DEFAULT_OFFER, OfferFormState } from '../components/PartOfferEditor';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  LoadingState,
  SearchField,
} from '../components/ui';
import { toast } from '../feedback';
import { createUuid } from '../id';
import { logger } from '../logging';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import { optimizeLocalImage } from '../storage/photos';
import { useStore } from '../store';
import { Part, PriceVariant, Supplier } from '../types';
import { readClipboardImageFiles } from '../utils/clipboardImages';
import { cloneVariantForPart, VariantLibraryItem } from '../variantLibraryStore';

const uniqueStrings = (items: string[]) => [
  ...new Set(items.map((value) => value.trim()).filter(Boolean)),
];
const purchasePrice = (variant: PriceVariant) =>
  Number(variant.purchasePriceAed ?? variant.priceAed);
const variantPhotos = (variant: PriceVariant) =>
  uniqueStrings([...(variant.photos || []), variant.photoUrl || '']);
const normalizePhone = (value: string) => value.replace(/\D/g, '');
const imageFile = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) throw new Error('Выберите файл изображения.');
  try {
    return await optimizeLocalImage(file, 'part-photo');
  } catch {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
};

export default function PartDetailsScreen() {
  const { orderId, partId } = useParams<{ orderId: string; partId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { orders, isLoading, updateOrder, suppliers, updateSupplier, variantLibrary } = useStore();
  const order = orders.find((item) => item.id === orderId);
  const part = order?.parts.find((item) => item.id === partId);
  const state = location.state as {
    backTo?: string;
    orderActiveTab?: string;
    orderScrollTop?: number;
    openVariantId?: string;
  } | null;
  const backTo = state?.backTo || `/order/${orderId}`;
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OfferFormState>(DEFAULT_OFFER);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [showDiscard, setShowDiscard] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [editError, setEditError] = useState('');
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [brokenPhotos, setBrokenPhotos] = useState<Record<string, true>>({});
  const [deletePhoto, setDeletePhoto] = useState<string | null>(null);
  const [deleteVariantId, setDeleteVariantId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryLimit, setLibraryLimit] = useState(40);
  const [sort, setSort] = useState('price');
  const [mutation, setMutation] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [savedId, setSavedId] = useState('');
  const sampleInput = useRef<HTMLInputElement>(null);
  const offersRef = useRef<HTMLElement>(null);
  const mutationLock = useRef(false);
  const initialForm = useRef('');
  const newVariantId = useRef<string | null>(null);
  const variants = part?.variants || [];
  const samplePhotos = uniqueStrings(part?.photos?.length ? part.photos : [part?.photoUrl || '']);
  const selected =
    variants.find((v) => v.id === part?.bestOfferId) || variants.find((v) => v.isBest);
  const minimum = useMemo(() => {
    const prices = variants
      .map(purchasePrice)
      .filter((price) => Number.isFinite(price) && price > 0);
    return prices.length ? Math.min(...prices) : undefined;
  }, [part?.variants]);
  const sorted = useMemo(
    () =>
      [...variants].sort((a, b) => {
        if (a.id === selected?.id) return -1;
        if (b.id === selected?.id) return 1;
        if (sort === 'recent') return b.createdAt - a.createdAt;
        return (
          (Number.isFinite(purchasePrice(a)) && purchasePrice(a) > 0
            ? purchasePrice(a)
            : Infinity) -
          (Number.isFinite(purchasePrice(b)) && purchasePrice(b) > 0 ? purchasePrice(b) : Infinity)
        );
      }),
    [part?.variants, selected?.id, sort],
  );
  const libraryMatches = (variantLibrary as VariantLibraryItem[]).filter(
    (item) =>
      item.sourcePartId !== part?.id &&
      `${item.sourcePartName} ${item.shopName} ${item.sourceOrderLabel}`
        .toLocaleLowerCase()
        .includes(librarySearch.trim().toLocaleLowerCase()),
  );
  const busy = mutation !== null;
  const depositPaid =
    order?.searchDepositStatus === 'paid' ||
    order?.paymentStatus === 'search_deposit_paid' ||
    order?.paymentStatus === 'full_prepayment_paid';

  useEffect(() => {
    setPhotoIndex(0);
    setSavedId('');
    setBrokenPhotos({});
    setIsAdding(false);
    setEditingId(null);
    setForm(DEFAULT_OFFER);
    setShowDiscard(false);
    setEditingName(false);
    setEditingDescription(false);
    setShowActions(false);
    setGallery(null);
    setShowLibrary(false);
    setDeletePhoto(null);
    setDeleteVariantId(null);
  }, [partId]);
  useEffect(() => {
    const id = state?.openVariantId || savedId;
    if (!id) return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(`variant-${id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [partId, state?.openVariantId, savedId]);

  if (isLoading && !order) return <LoadingState />;
  if (!order || !part)
    return (
      <div className="ui-page">
        <EmptyState
          icon={Layers3}
          title="Деталь не найдена"
          description="Она могла быть удалена из заказа."
          action={
            <Button onClick={() => navigate(order ? `/order/${order.id}` : '/orders')}>
              К заказам
            </Button>
          }
        />
      </div>
    );
  const currentPartIndex = order.parts.findIndex((item) => item.id === part.id);
  const currentPhotoIndex = Math.min(photoIndex, Math.max(0, samplePhotos.length - 1));
  const currentPhoto = samplePhotos[currentPhotoIndex];
  const photoVisible = currentPhoto && !brokenPhotos[currentPhoto];
  const startMutation = (key: string) => {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setMutation(key);
    return true;
  };
  const endMutation = () => {
    mutationLock.current = false;
    setMutation(null);
  };
  const goBack = () =>
    navigate(backTo, {
      state: {
        ...(typeof state?.orderScrollTop === 'number'
          ? { restoreScrollTop: state.orderScrollTop }
          : {}),
        ...(state?.orderActiveTab ? { restoreActiveTab: state.orderActiveTab } : {}),
      },
    });
  const sibling = (offset: number) => {
    const next = order.parts[(currentPartIndex + offset + order.parts.length) % order.parts.length];
    navigate(`/order/${order.id}/part/${next.id}`, {
      state: { ...state, backTo, openVariantId: undefined },
    });
  };
  const patchPart = async (patch: Partial<Part>, key: string): Promise<boolean> => {
    if (!startMutation(key)) return false;
    try {
      return await updateOrder({
        ...order,
        parts: order.parts.map((item) => (item.id === part.id ? { ...item, ...patch } : item)),
      });
    } catch (error) {
      void logger.error('part-details', 'part_update_failed', { error: String(error) });
      return false;
    } finally {
      endMutation();
    }
  };
  const openName = () => {
    setNameDraft(part.name);
    setEditError('');
    setShowActions(false);
    setEditingName(true);
  };
  const openDescription = () => {
    setDescriptionDraft(part.comment || '');
    setEditError('');
    setShowActions(false);
    setEditingDescription(true);
  };
  const saveName = async () => {
    if (!nameDraft.trim()) {
      setEditError('Укажите название детали.');
      return;
    }
    if (await patchPart({ name: nameDraft.trim() }, 'name')) setEditingName(false);
    else setEditError('Название не сохранилось. Попробуйте ещё раз.');
  };
  const saveDescription = async () => {
    if (await patchPart({ comment: descriptionDraft.trim() }, 'description'))
      setEditingDescription(false);
    else setEditError('Описание не сохранилось. Данные остались в форме.');
  };
  const addSamplePhotos = async (files: File[]) => {
    if (!files.length || !startMutation('photos')) return;
    try {
      const incoming = await Promise.all(files.map(imageFile));
      const photos = uniqueStrings([...samplePhotos, ...incoming]);
      const ok = await updateOrder({
        ...order,
        parts: order.parts.map((item) =>
          item.id === part.id ? { ...item, photos, photoUrl: photos[0] || '' } : item,
        ),
      });
      if (!ok) throw new Error('Фотографии не сохранились. Попробуйте ещё раз.');
      setPhotoIndex(samplePhotos.length);
      toast('Фото добавлены', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Не удалось добавить фото.', 'error');
    } finally {
      endMutation();
    }
  };
  const pasteSamplePhotos = async () => {
    try {
      const files = await readClipboardImageFiles();
      if (!files.length) {
        toast('В буфере нет изображений. Выберите фото с устройства.', 'info');
        return;
      }
      await addSamplePhotos(files);
    } catch {
      toast('Буфер обмена недоступен. Выберите фото с устройства.', 'info');
    }
  };
  const removeSample = async () => {
    if (!deletePhoto) return;
    const photos = samplePhotos.filter((photo) => photo !== deletePhoto);
    if (await patchPart({ photos, photoUrl: photos[0] || '' }, 'photos')) {
      setDeletePhoto(null);
      setPhotoIndex(Math.min(currentPhotoIndex, Math.max(0, photos.length - 1)));
      toast('Фото удалено', 'success');
    } else toast('Фото не удалось удалить. Попробуйте ещё раз.', 'error');
  };
  const copyVin = async () => {
    try {
      await navigator.clipboard.writeText(order.vin);
      toast('VIN скопирован', 'success');
      setShowActions(false);
    } catch {
      toast('Не удалось скопировать VIN.', 'info');
    }
  };
  const openOffer = (variant?: PriceVariant) => {
    if (!depositPaid) return;
    const latest = order.parts
      .flatMap((item) => item.variants || [])
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const next: OfferFormState = variant
      ? {
          purchasePriceAed: String(variant.purchasePriceAed ?? variant.priceAed),
          salePriceAed: String(variant.salePriceAed ?? variant.priceAed),
          shopName: variant.shopName || '',
          supplierId: variant.shopId,
          phone: variant.phone || '',
          locationText: variant.locationText || variant.location || '',
          mapsUrl: variant.mapsUrl || '',
          photos: variantPhotos(variant),
          condition: variant.condition || 'used',
          availability: variant.availability || 'in_stock',
          deliveryEta: variant.deliveryEta || 'today',
          isBest: variant.id === selected?.id,
          note: variant.note || '',
        }
      : {
          ...DEFAULT_OFFER,
          shopName: latest?.shopName || '',
          supplierId: latest?.shopId,
          phone: latest?.phone || '',
          locationText: latest?.locationText || latest?.location || '',
        };
    initialForm.current = JSON.stringify(next);
    newVariantId.current = variant?.id || createUuid();
    setForm(next);
    setEditingId(variant?.id || null);
    setFormErrors({});
    setFormError('');
    setIsAdding(true);
  };
  const closeOffer = () => {
    setIsAdding(false);
    setEditingId(null);
    setShowDiscard(false);
    setForm(DEFAULT_OFFER);
  };
  const requestCloseOffer = () => {
    if (busy) return;
    if (JSON.stringify(form) !== initialForm.current) setShowDiscard(true);
    else closeOffer();
  };
  const patchForm = <K extends keyof OfferFormState>(key: K, value: OfferFormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setFormError('');
    setFormErrors((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([field]) => field !== key)),
    );
  };
  const chooseSupplier = (supplier: Supplier) =>
    setForm((previous) => ({
      ...previous,
      shopName: supplier.name,
      supplierId: supplier.id,
      phone: supplier.phone || '',
      locationText: supplier.location || '',
    }));
  const addOfferPhotos = async (files: File[]) => {
    if (!files.length || !startMutation('offer-photos')) return;
    try {
      const photos = await Promise.all(files.map(imageFile));
      setForm((previous) => ({
        ...previous,
        photos: uniqueStrings([...previous.photos, ...photos]),
      }));
    } catch {
      setFormError('Не удалось открыть фото. Выберите другой файл.');
    } finally {
      endMutation();
    }
  };
  const pasteOfferPhotos = async () => {
    try {
      const files = await readClipboardImageFiles();
      if (files.length) await addOfferPhotos(files);
      else toast('В буфере нет изображений.', 'info');
    } catch {
      toast('Буфер недоступен. Выберите фото с устройства.', 'info');
    }
  };
  const locate = () => {
    if (!navigator.geolocation) {
      toast('Местоположение недоступно. Введите адрес вручную.', 'info');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setForm((previous) => ({
          ...previous,
          mapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
          locationText: previous.locationText || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        }));
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast('Не удалось определить местоположение. Введите адрес вручную.', 'info');
      },
      { timeout: 10000 },
    );
  };
  const saveOffer = async () => {
    const price = Number(form.purchasePriceAed);
    const errors: Record<string, string> = {};
    if (!Number.isFinite(price) || price <= 0)
      errors.purchasePriceAed = 'Введите цену больше нуля.';
    if (!form.shopName.trim()) errors.shopName = 'Укажите название поставщика.';
    if (form.phone.trim() && normalizePhone(form.phone).length < 7)
      errors.phone = 'Укажите полный номер или оставьте поле пустым.';
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      document
        .querySelector<HTMLInputElement>(
          errors.purchasePriceAed
            ? '[aria-label="Цена закупки, AED"]'
            : errors.shopName
              ? '[aria-label="Название поставщика"]'
              : 'input[type="tel"]',
        )
        ?.focus();
      return;
    }
    if (!depositPaid || !startMutation('offer')) return;
    setFormError('');
    try {
      const digits = normalizePhone(form.phone);
      const phone =
        digits.length >= 7
          ? form.phone.trim().startsWith('+')
            ? form.phone.trim()
            : `+${digits}`
          : '';
      const existing =
        suppliers.find(
          (s) =>
            s.id === form.supplierId ||
            s.name.trim().toLocaleLowerCase() === form.shopName.trim().toLocaleLowerCase(),
        ) ||
        (digits.length >= 7
          ? suppliers.find((s) => normalizePhone(s.phone) === digits)
          : undefined);
      const coordinates = await resolveCoordinatesFromLocation(form.mapsUrl || form.locationText);
      const id = newVariantId.current || createUuid();
      newVariantId.current = id;
      const supplierId = existing?.id || createUuid();
      const offer: PriceVariant = {
        id,
        orderId: order.id,
        partId: part.id,
        priceAed: Number(form.salePriceAed) || price,
        purchasePriceAed: price,
        salePriceAed: Number(form.salePriceAed) || price,
        currency: 'AED',
        shopName: form.shopName.trim(),
        shopNameManual: form.shopName.trim(),
        shopId: supplierId,
        phone,
        location: form.locationText.trim(),
        locationText: form.locationText.trim(),
        mapsUrl: form.mapsUrl.trim(),
        lat: coordinates?.lat,
        lng: coordinates?.lng,
        photos: form.photos,
        photoUrl: form.photos[0] || '',
        condition: form.condition,
        availability: form.availability,
        deliveryEta: form.deliveryEta,
        isBest: form.isBest,
        syncStatus: 'synced',
        note: form.note.trim(),
        createdAt: variants.find((v) => v.id === id)?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      const list = variants.some((v) => v.id === id)
        ? variants.map((v) => (v.id === id ? offer : v))
        : [offer, ...variants];
      const bestId = form.isBest ? id : selected?.id === id ? undefined : selected?.id;
      const ok = await updateOrder({
        ...order,
        parts: order.parts.map((item) =>
          item.id === part.id
            ? {
                ...item,
                variants: list.map((v) => ({ ...v, isBest: v.id === bestId })),
                bestOfferId: bestId,
                isFound: true,
                status: 'found',
              }
            : item,
        ),
      });
      if (!ok) {
        setFormError('Вариант не сохранился. Данные остались в форме — попробуйте ещё раз.');
        return;
      }
      const brands = uniqueStrings([
        ...(existing?.mainBrands || existing?.brands || []),
        order.brand,
      ]);
      const linked = {
        id: createUuid(),
        orderId: order.id,
        orderLabel: `${order.brand} ${order.model}`,
        partId: part.id,
        partName: part.name,
        status: 'found' as const,
        source: 'variant' as const,
        priceAed: price,
        updatedAt: Date.now(),
      };
      const linkedParts = [...(existing?.linkedParts || [])];
      const linkedIndex = linkedParts.findIndex(
        (item) => item.orderId === order.id && item.partId === part.id,
      );
      if (linkedIndex >= 0)
        linkedParts[linkedIndex] = {
          ...linkedParts[linkedIndex],
          ...linked,
          id: linkedParts[linkedIndex].id,
        };
      else linkedParts.unshift(linked);
      updateSupplier({
        ...existing,
        id: supplierId,
        name: existing?.name || form.shopName.trim(),
        phone: existing?.phone || phone,
        location: existing?.location || form.locationText.trim(),
        type: existing?.type || (form.condition === 'new' ? 'new_parts' : 'scrapyard'),
        brands,
        mainBrands: brands,
        primaryBrand: existing?.primaryBrand || brands[0],
        models: uniqueStrings([...(existing?.models || []), order.model]),
        bodyTypes: uniqueStrings([...(existing?.bodyTypes || []), order.bodyType || '']),
        years: [
          ...new Set([...(existing?.years || []), Number(order.year)].filter(Number.isFinite)),
        ],
        activeOrderIds: [...new Set([...(existing?.activeOrderIds || []), order.id])],
        linkedParts,
        coordinates: existing?.coordinates || coordinates,
      } as Supplier);
      setSavedId(id);
      toast(editingId ? 'Вариант обновлён' : 'Вариант добавлен', 'success');
      closeOffer();
    } catch (error) {
      void logger.error('part-details', 'save_offer_failed', { error: String(error) });
      setFormError('Не удалось сохранить вариант. Данные остались в форме.');
    } finally {
      endMutation();
    }
  };
  const chooseOffer = async (variant: PriceVariant) => {
    const bestId = selected?.id === variant.id ? undefined : variant.id;
    if (
      await patchPart(
        {
          bestOfferId: bestId,
          variants: variants.map((v) => ({ ...v, isBest: v.id === bestId })),
          isFound: true,
          status: 'found',
        },
        'select',
      )
    )
      toast(bestId ? 'Вариант выбран для заказа' : 'Выбор отменён', 'success');
    else toast('Выбор не сохранился. Попробуйте ещё раз.', 'error');
  };
  const removeOffer = async () => {
    if (!deleteVariantId) return;
    const list = variants.filter((v) => v.id !== deleteVariantId);
    if (
      await patchPart(
        {
          variants: list,
          bestOfferId: selected?.id === deleteVariantId ? undefined : selected?.id,
          isFound: list.length > 0,
          status: list.length ? 'found' : 'not_found',
        },
        'delete',
      )
    ) {
      setDeleteVariantId(null);
      toast('Вариант удалён', 'success');
    } else toast('Вариант не удалось удалить. Попробуйте ещё раз.', 'error');
  };
  const attach = async (item: VariantLibraryItem) => {
    if (!depositPaid) return;
    const offer = { ...cloneVariantForPart(item, part.id), orderId: order.id, isBest: false };
    if (
      await patchPart({ variants: [offer, ...variants], isFound: true, status: 'found' }, 'attach')
    ) {
      setShowLibrary(false);
      setSavedId(offer.id);
      toast('Вариант добавлен из базы', 'success');
    } else toast('Вариант не удалось добавить. Попробуйте ещё раз.', 'error');
  };
  const whatsapp = (variant: PriceVariant) => {
    const phone = normalizePhone(variant.phone);
    if (phone.length < 7) return;
    const message = `Здравствуйте. Нужна деталь: ${part.name} для ${order.brand} ${order.model} ${order.year}.\nЕсть в наличии? Какая цена и состояние?\nПришлите фото и номер детали.${order.vin ? `\nVIN: ${order.vin}` : ''}`;
    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <div className="part-detail-page">
      <header className="part-detail-header">
        <IconButton label="Назад" icon={ArrowLeft} disabled={busy} onClick={goBack} />
        <div className="part-detail-title">
          <p className="ui-eyebrow">Карточка детали</p>
          <h1>{part.name}</h1>
          <button
            type="button"
            onClick={() => navigate(`/order/${order.id}`)}
            className="part-detail-car-link"
          >
            {order.brand} {order.model} · {order.year}
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
        <IconButton
          label="Действия с деталью"
          icon={MoreHorizontal}
          disabled={busy}
          onClick={() => setShowActions(true)}
        />
      </header>
      {order.parts.length > 1 && (
        <nav aria-label="Детали заказа" className="part-detail-siblings">
          <IconButton
            label="Предыдущая деталь"
            icon={ChevronLeft}
            disabled={busy}
            onClick={() => sibling(-1)}
          />
          <span>
            Деталь {currentPartIndex + 1} из {order.parts.length}
          </span>
          <IconButton
            label="Следующая деталь"
            icon={ChevronRight}
            disabled={busy}
            onClick={() => sibling(1)}
          />
        </nav>
      )}
      {!depositPaid && (
        <div className="part-detail-deposit">
          <CircleAlert size={19} aria-hidden="true" />
          <p>Подтвердите депозит в заказе, чтобы добавлять варианты.</p>
          <Button variant="ghost" onClick={() => navigate(`/order/${order.id}`)}>
            К заказу
          </Button>
        </div>
      )}
      <div className="part-detail-layout">
        <div className="part-detail-reference">
          <section className="part-detail-photo-card" aria-labelledby="part-photo-heading">
            <div className="part-detail-section-heading">
              <div>
                <h2 id="part-photo-heading">Фото детали</h2>
                <p>Образец для подбора</p>
              </div>
              {currentPhoto && (
                <IconButton
                  label={`Удалить фото ${currentPhotoIndex + 1}`}
                  icon={Trash2}
                  disabled={busy}
                  onClick={() => setDeletePhoto(currentPhoto)}
                />
              )}
            </div>
            <div className={`part-detail-photo-frame ${currentPhoto ? 'has-photo' : ''}`}>
              {currentPhoto ? (
                <button
                  type="button"
                  className="part-detail-photo-open"
                  aria-label="Открыть фото детали"
                  onClick={() => setGallery({ images: samplePhotos, index: currentPhotoIndex })}
                >
                  {photoVisible ? (
                    <img
                      src={currentPhoto}
                      alt={part.name}
                      onError={() =>
                        setBrokenPhotos((previous) => ({ ...previous, [currentPhoto]: true }))
                      }
                    />
                  ) : (
                    <span className="part-detail-photo-unavailable">
                      <Images size={32} aria-hidden="true" />
                      <span>Фото недоступно</span>
                    </span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  className="part-detail-photo-empty"
                  disabled={busy}
                  onClick={() => sampleInput.current?.click()}
                >
                  <Camera size={32} aria-hidden="true" />
                  <strong>Добавьте образец детали</strong>
                  <span>Фото поможет подобрать точный вариант</span>
                </button>
              )}
              {samplePhotos.length > 0 && (
                <span className="part-detail-photo-count">
                  {currentPhotoIndex + 1} / {samplePhotos.length}
                </span>
              )}
            </div>
            {samplePhotos.length > 1 && (
              <div className="part-detail-thumbnails" aria-label="Фотографии детали">
                {samplePhotos.map((photo, index) => (
                  <button
                    type="button"
                    key={`${photo}-${index}`}
                    aria-label={`Показать фото детали ${index + 1}`}
                    aria-pressed={index === currentPhotoIndex}
                    onClick={() => setPhotoIndex(index)}
                  >
                    {brokenPhotos[photo] ? (
                      <Images size={22} aria-hidden="true" />
                    ) : (
                      <img
                        src={photo}
                        alt={`Образец ${index + 1}`}
                        onError={() =>
                          setBrokenPhotos((previous) => ({ ...previous, [photo]: true }))
                        }
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className="part-detail-photo-actions">
              <Button
                variant="secondary"
                icon={Camera}
                loading={mutation === 'photos'}
                disabled={busy}
                onClick={() => sampleInput.current?.click()}
              >
                Фото
              </Button>
              <Button
                variant="ghost"
                icon={ClipboardPaste}
                disabled={busy}
                onClick={() => void pasteSamplePhotos()}
              >
                Из буфера
              </Button>
            </div>
            <input
              type="file"
              ref={sampleInput}
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = '';
                void addSamplePhotos(files);
              }}
            />
          </section>
          <section className="part-detail-description">
            <div className="part-detail-section-heading">
              <div>
                <h2>Описание</h2>
              </div>
              <IconButton
                label="Изменить описание детали"
                icon={Pencil}
                disabled={busy}
                onClick={openDescription}
              />
            </div>
            {part.comment ? (
              <p className="part-detail-description-text">{part.comment}</p>
            ) : (
              <div className="part-detail-description-empty">
                <FileText size={22} aria-hidden="true" />
                <p>Укажите номер, цвет, сторону или особенности детали.</p>
                <Button variant="ghost" onClick={openDescription}>
                  Добавить описание
                </Button>
              </div>
            )}
          </section>
          {order.vin && (
            <button
              type="button"
              className="part-detail-vin"
              onClick={() => void copyVin()}
              aria-label="Скопировать VIN"
            >
              <div>
                <span>VIN автомобиля</span>
                <code>{order.vin}</code>
              </div>
              <Copy size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <section
          ref={offersRef}
          className="part-detail-offers"
          aria-labelledby="part-offers-heading"
        >
          <div className="part-detail-offers-heading">
            <div>
              <h2 id="part-offers-heading">
                Варианты <span>{variants.length}</span>
              </h2>
              <p>Сравните предложения и выберите подходящее</p>
            </div>
          </div>
          <div className="part-detail-create-actions">
            <Button icon={Plus} disabled={!depositPaid || busy} onClick={() => openOffer()}>
              Добавить вариант
            </Button>
            <Button
              variant="secondary"
              icon={Layers3}
              disabled={!depositPaid || busy}
              onClick={() => {
                setLibrarySearch('');
                setLibraryLimit(40);
                setShowLibrary(true);
              }}
            >
              Из базы данных
            </Button>
          </div>
          {variants.length > 0 && (
            <>
              <div className="part-detail-offer-summary">
                <div>
                  <span>Минимальная закупка</span>
                  <strong>{formatOfferPrice(minimum)}</strong>
                </div>
                <div>
                  <span>Для заказа</span>
                  <strong className={!selected ? 'is-empty' : ''}>
                    {selected ? formatOfferPrice(purchasePrice(selected)) : 'Не выбран'}
                  </strong>
                </div>
              </div>
              <div className="part-detail-sort">
                <label htmlFor="part-variant-sort">Порядок вариантов</label>
                <select
                  id="part-variant-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="price">Сначала дешевле</option>
                  <option value="recent">Сначала новые</option>
                </select>
              </div>
            </>
          )}
          {variants.length === 0 ? (
            <div className="part-detail-offers-empty">
              <span>
                <Layers3 size={30} aria-hidden="true" />
              </span>
              <h3>Пока нет предложений</h3>
              <p>Добавьте цену поставщика или выберите готовый вариант из своей базы.</p>
            </div>
          ) : (
            <div className="part-detail-offer-list">
              {sorted.map((variant) => {
                const photos = variantPhotos(variant);
                const photo = photos.find((image) => !brokenPhotos[image]);
                return (
                  <PartOfferCard
                    key={variant.id}
                    variant={variant}
                    selected={selected?.id === variant.id}
                    lowest={minimum !== undefined && purchasePrice(variant) === minimum}
                    photo={photo}
                    photoCount={photos.length}
                    busy={busy}
                    editable={Boolean(depositPaid)}
                    highlighted={savedId === variant.id || state?.openVariantId === variant.id}
                    onSelect={() => void chooseOffer(variant)}
                    onEdit={() => openOffer(variant)}
                    onDelete={() => setDeleteVariantId(variant.id)}
                    onPhoto={() =>
                      setGallery({
                        images: photos,
                        index: Math.max(0, photos.indexOf(photo || '')),
                      })
                    }
                    onPhotoError={() => {
                      if (photo) setBrokenPhotos((previous) => ({ ...previous, [photo]: true }));
                    }}
                    onWhatsapp={() => whatsapp(variant)}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
      {isAdding && (
        <PartOfferEditor
          form={form}
          patch={patchForm}
          suppliers={suppliers}
          editing={Boolean(editingId)}
          busy={busy}
          error={formError}
          fieldErrors={formErrors}
          partName={part.name}
          onSave={saveOffer}
          onClose={requestCloseOffer}
          onSelectSupplier={chooseSupplier}
          onPhotos={addOfferPhotos}
          onPastePhotos={pasteOfferPhotos}
          onRemovePhoto={(index) =>
            patchForm(
              'photos',
              form.photos.filter((_, i) => i !== index),
            )
          }
          onPreview={(index) => setGallery({ images: form.photos, index })}
          onLocate={locate}
          locating={locating}
        />
      )}
      {showDiscard && (
        <Dialog
          title="Закрыть без сохранения?"
          onClose={() => setShowDiscard(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowDiscard(false)}>
                Продолжить заполнение
              </Button>
              <Button variant="danger" onClick={closeOffer}>
                Закрыть без сохранения
              </Button>
            </>
          }
        >
          <p className="ui-description">Изменения в форме варианта будут потеряны.</p>
        </Dialog>
      )}
      {showActions && (
        <Dialog title="Действия с деталью" onClose={() => setShowActions(false)}>
          <div className="part-detail-action-list">
            <Button variant="ghost" icon={Pencil} onClick={openName}>
              Изменить название детали
            </Button>
            <Button variant="ghost" icon={FileText} onClick={openDescription}>
              Изменить описание детали
            </Button>
            {order.vin && (
              <Button variant="ghost" icon={Copy} onClick={() => void copyVin()}>
                Скопировать VIN
              </Button>
            )}
          </div>
        </Dialog>
      )}
      {editingName && (
        <Dialog
          title="Название детали"
          onClose={() => {
            if (!busy) setEditingName(false);
          }}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setEditingName(false)}>
                Отмена
              </Button>
              <Button type="submit" form="part-name-form" loading={mutation === 'name'}>
                Сохранить название
              </Button>
            </>
          }
        >
          <form
            id="part-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <Field label="Название детали" error={editError} required>
              <input
                autoFocus
                value={nameDraft}
                disabled={busy}
                maxLength={160}
                onChange={(event) => {
                  setNameDraft(event.target.value);
                  setEditError('');
                }}
                className="ui-input"
              />
            </Field>
          </form>
        </Dialog>
      )}
      {editingDescription && (
        <Dialog
          title="Описание детали"
          onClose={() => {
            if (!busy) setEditingDescription(false);
          }}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setEditingDescription(false)}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                form="part-description-form"
                loading={mutation === 'description'}
              >
                Сохранить описание
              </Button>
            </>
          }
        >
          <form
            id="part-description-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDescription();
            }}
          >
            <Field label="Описание детали" error={editError}>
              <textarea
                autoFocus
                rows={5}
                disabled={busy}
                maxLength={3000}
                value={descriptionDraft}
                onChange={(event) => {
                  setDescriptionDraft(event.target.value);
                  setEditError('');
                }}
                placeholder="Номер детали, сторона, цвет, комплектность…"
                className="ui-input"
              />
            </Field>
          </form>
        </Dialog>
      )}
      <ConfirmModal
        isOpen={Boolean(deletePhoto)}
        loading={mutation === 'photos'}
        message="Удалить это фото детали?"
        onConfirm={() => {
          if (!busy) void removeSample();
        }}
        onCancel={() => {
          if (!busy) setDeletePhoto(null);
        }}
      />
      <ConfirmModal
        isOpen={Boolean(deleteVariantId)}
        loading={mutation === 'delete'}
        message="Удалить этот вариант из детали?"
        onConfirm={() => {
          if (!busy) void removeOffer();
        }}
        onCancel={() => {
          if (!busy) setDeleteVariantId(null);
        }}
      />
      {showLibrary && (
        <Dialog
          title="Выбрать вариант"
          onClose={() => {
            if (!busy) setShowLibrary(false);
          }}
        >
          <div className="part-detail-library">
            <SearchField
              label="Поиск по базе вариантов"
              value={librarySearch}
              onChange={(value) => {
                setLibrarySearch(value);
                setLibraryLimit(40);
              }}
              placeholder="Деталь или поставщик"
            />
            {libraryMatches.length === 0 ? (
              <EmptyState
                icon={Search}
                title={librarySearch ? 'Ничего не найдено' : 'База вариантов пуста'}
                description={
                  librarySearch
                    ? 'Попробуйте другую деталь или название поставщика.'
                    : 'Сохранённые предложения появятся здесь.'
                }
              />
            ) : (
              <>
                <p className="part-editor-hint">Найдено: {libraryMatches.length}</p>
                {libraryMatches.slice(0, libraryLimit).map((item) => (
                  <button
                    type="button"
                    key={`${item.origin}-${item.id}-${item.sourceOrderId || ''}`}
                    disabled={busy}
                    onClick={() => void attach(item)}
                    className="part-detail-library-item"
                  >
                    <div>
                      <strong>{item.sourcePartName || 'Деталь'}</strong>
                      <span>
                        {item.shopName || 'Поставщик'} ·{' '}
                        {item.origin === 'standalone'
                          ? 'Из базы вариантов'
                          : item.sourceOrderLabel || 'Из заказа'}
                      </span>
                    </div>
                    <b>{formatOfferPrice(item.purchasePriceAed ?? item.priceAed)}</b>
                    <Plus size={18} aria-hidden="true" />
                  </button>
                ))}
                {libraryMatches.length > libraryLimit && (
                  <Button
                    variant="secondary"
                    onClick={() => setLibraryLimit((value) => value + 40)}
                  >
                    Показать ещё
                  </Button>
                )}
              </>
            )}
          </div>
        </Dialog>
      )}
      {gallery && (
        <ImagePreview
          images={gallery.images}
          initialIndex={gallery.index}
          shareTitle={part.name}
          shareText={`${part.name} · ${order.brand} ${order.model}`}
          onClose={() => setGallery(null)}
        />
      )}
    </div>
  );
}
