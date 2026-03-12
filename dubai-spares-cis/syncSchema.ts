export const ORDER_GRAPH_COLUMNS = [
  'id','brand','model','year','body_type','vin','vin_photo_url','priority','client_name','source','car_photo_url','car_photos','markup_percent','markup_type','markup_fixed_aed','use_markup_as_default_for_new_parts','client_currency','fx_updated_at','logistics','cargo_country','delivery_aed','packing_aed','service_fee_aed','exchange_rate','created_at','is_archived','is_sold','sold_profit_usd','is_vip','is_pinned','is_lead','customer_status','status_changed_at','status_changed_by','notes','status','sales_status','customer_contact','social_nickname','contact_links','updated_at','recommended_shop_ids','dismissed_shop_ids','lead_unread','lead_source','lead_read_at','pricing_events','vendor_contacts','vendor_checklist','vehicle_details'
] as const;

export const COMPAT_TABLE_COLUMNS = {
  orders: [...ORDER_GRAPH_COLUMNS],
  parts: ['id','order_id','name','comment','quantity','part_kind','group_items','photo_url','photos','is_found','weight_kg','length_cm','width_cm','height_cm','places','cargo_place_group','is_oversized'],
  price_variants: ['id','part_id','price_aed','condition','availability','shop_name','shop_id','phone','location','photo_url','photos','created_at'],
  public_quote_snapshots: ['token','order_id','payload','created_at','expires_at']
} as const;

type CompatTableName = keyof typeof COMPAT_TABLE_COLUMNS;

const STORAGE_KEY = 'sync_schema_missing_columns_v1';
const runtimeMissingColumns = new Map<CompatTableName, Set<string>>();

const loadMissingColumns = () => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Record<CompatTableName, string[]>>;
    (Object.keys(parsed) as CompatTableName[]).forEach((table) => {
      const values = parsed[table] || [];
      runtimeMissingColumns.set(table, new Set(values));
    });
  } catch {
    runtimeMissingColumns.clear();
  }
};

const persistMissingColumns = () => {
  try {
    const payload = Array.from(runtimeMissingColumns.entries()).reduce((acc, [table, columns]) => {
      acc[table] = Array.from(columns);
      return acc;
    }, {} as Record<CompatTableName, string[]>);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // no-op in private mode
  }
};

loadMissingColumns();

export const getSelectableColumns = (table: CompatTableName) => {
  const missing = runtimeMissingColumns.get(table);
  if (!missing || missing.size === 0) return [...COMPAT_TABLE_COLUMNS[table]];
  return COMPAT_TABLE_COLUMNS[table].filter((column) => !missing.has(column));
};

export const markMissingColumn = (table: CompatTableName, column: string) => {
  const knownColumns = new Set(COMPAT_TABLE_COLUMNS[table]);
  if (!knownColumns.has(column as any)) return false;
  const existing = runtimeMissingColumns.get(table) || new Set<string>();
  if (existing.has(column)) return false;
  existing.add(column);
  runtimeMissingColumns.set(table, existing);
  persistMissingColumns();
  return true;
};
